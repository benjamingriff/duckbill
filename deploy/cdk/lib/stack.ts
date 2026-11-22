import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
  aws_budgets as budgets,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as actions,
  aws_ecr_assets as ecrAssets,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// SecureString parameters. CloudFormation can't create SecureStrings, so these
// are put once by hand (see deploy/setup.sh); the stack only grants access.
export const PARAMETERS = {
  monzoToken: "/duckbill/monzo-token", // read and rewritten by ingest only
  monzoClient: "/duckbill/monzo-client", // {"client_id", "client_secret"}
  motherduckToken: "/duckbill/motherduck-token", // writer service account
} as const;

// Every named resource starts with this, so the account reads as one app.
const PREFIX = "duckbill";
// The GitHub deploy role (github.ts) may start this one after a deploy.
export const DBT_FUNCTION_NAME = `${PREFIX}-dbt`;
// Monthly AWS spend in USD above which you're emailed (see the Budget below).
const MONTHLY_BUDGET_USD = 5;

export interface DuckbillStackProps extends StackProps {
  // Where failure alarms are emailed. AWS sends a confirmation email first.
  alertEmail: string;
  // MotherDuck database the dbt function publishes into.
  motherduckDatabase?: string;
}

/**
 * Everything duckbill runs in AWS: the raw bucket, the daily ingest function
 * (the only holder of the Monzo token), the dbt function that publishes to
 * MotherDuck, failure alarms and a monthly budget. The web app runs elsewhere
 * (Railway), and GitHub deploys through the role in github.ts.
 */
export class DuckbillStack extends Stack {
  constructor(scope: Construct, id: string, props: DuckbillStackProps) {
    super(scope, id, props);

    // Raw files are the only copy of history older than Monzo's 90 days, so
    // the bucket is versioned and survives the stack being deleted. Bucket
    // names are global across AWS, so the account and region keep it unique.
    const bucket = new s3.Bucket(this, "Raw", {
      bucketName: `${PREFIX}-raw-${this.account}-${this.region}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
    });
    const storageUri = `s3://${bucket.bucketName}`;

    const image = (cmd: string) =>
      lambda.DockerImageCode.fromImageAsset(repoRoot, {
        file: "deploy/lambda/Dockerfile",
        cmd: [cmd],
        platform: ecrAssets.Platform.LINUX_AMD64,
      });
    // Each function gets its own role and log group, named after the function
    // (e.g. duckbill-dbt) at the path Lambda would use by default.
    const logGroup = (id: string, functionName: string) =>
      new logs.LogGroup(this, `${id}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    const role = (id: string, functionName: string) =>
      new iam.Role(this, `${id}Role`, {
        roleName: functionName,
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        ],
      });
    const parameterArn = (name: string) =>
      this.formatArn({ service: "ssm", resource: "parameter", resourceName: name.slice(1) });

    const dbtName = DBT_FUNCTION_NAME;
    const dbt = new lambda.DockerImageFunction(this, "Dbt", {
      functionName: dbtName,
      role: role("Dbt", dbtName),
      description: "dbt build from raw in S3, publish to MotherDuck",
      code: image("duckbill_ingest.aws.dbt_handler"),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      ephemeralStorageSize: Size.mebibytes(1024),
      timeout: Duration.minutes(10),
      // No reserved concurrency (see Ingest). Two overlapping builds each
      // publish in one transaction, so the worst case is an older build landing
      // last and the dashboard trailing until the next daily run.
      retryAttempts: 0,
      logGroup: logGroup("Dbt", dbtName),
      environment: {
        DUCKBILL_STORAGE_URI: storageUri,
        DUCKBILL_PUBLISH_TO: `md:${props.motherduckDatabase ?? "duckbill"}`,
        DUCKBILL_MOTHERDUCK_TOKEN_PARAMETER: PARAMETERS.motherduckToken,
      },
    });
    bucket.grantRead(dbt);
    dbt.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [parameterArn(PARAMETERS.motherduckToken)],
      }),
    );

    // No reserved concurrency: reserving any needs an account limit of at least
    // 100 + the reservation, and new accounts often start at 10. The daily
    // schedule can't overlap itself (5 minute timeout), so overlap needs a manual
    // invoke or a duplicate async event. Then both runs refresh the same
    // single-use Monzo token: one saves the new pair, the other is rejected and
    // fails, and its retry loads the saved token. Raw files from both are
    // deduplicated in silver.
    const ingestName = `${PREFIX}-ingest`;
    const ingest = new lambda.DockerImageFunction(this, "Ingest", {
      functionName: ingestName,
      role: role("Ingest", ingestName),
      description: "Daily Monzo sync into S3, then starts the dbt function",
      code: image("duckbill_ingest.aws.ingest_handler"),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: Duration.minutes(5),
      retryAttempts: 1,
      logGroup: logGroup("Ingest", ingestName),
      environment: {
        DUCKBILL_STORAGE_URI: storageUri,
        DUCKBILL_TOKEN_PARAMETER: PARAMETERS.monzoToken,
        DUCKBILL_MONZO_CLIENT_PARAMETER: PARAMETERS.monzoClient,
        DUCKBILL_DBT_FUNCTION: dbt.functionName,
      },
    });
    bucket.grantRead(ingest);
    bucket.grantPut(ingest);
    dbt.grantInvoke(ingest);
    ingest.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [parameterArn(PARAMETERS.monzoToken), parameterArn(PARAMETERS.monzoClient)],
      }),
    );
    ingest.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:PutParameter"],
        resources: [parameterArn(PARAMETERS.monzoToken)],
      }),
    );

    new events.Rule(this, "Daily", {
      ruleName: `${PREFIX}-daily`,
      description: "Run the duckbill ingest every morning",
      schedule: events.Schedule.cron({ minute: "0", hour: "5" }),
      targets: [new targets.LambdaFunction(ingest)],
    });

    const alerts = new sns.Topic(this, "Alerts", { topicName: `${PREFIX}-alerts` });
    alerts.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    const alarm = (id: string, name: string, metric: cloudwatch.Metric, description: string) => {
      new cloudwatch.Alarm(this, id, {
        alarmName: `${PREFIX}-${name}`,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
      }).addAlarmAction(new actions.SnsAction(alerts));
    };
    const daily = { period: Duration.days(1), statistic: "Sum" };
    alarm(
      "IngestFailed",
      "ingest-failed",
      ingest.metricErrors(daily),
      "Monzo sync failed. If the logs say the token can't be refreshed, run `duckbill login`.",
    );
    alarm(
      "DbtFailed",
      "dbt-failed",
      dbt.metricErrors(daily),
      "dbt build or MotherDuck publish failed.",
    );
    new cloudwatch.Alarm(this, "IngestDidNotRun", {
      alarmName: `${PREFIX}-ingest-did-not-run`,
      metric: ingest.metricInvocations(daily),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: "The daily Monzo sync hasn't run for two days.",
    }).addAlarmAction(new actions.SnsAction(alerts));

    // Whole-account spend, not just duckbill's: splitting costs out needs cost
    // allocation tags switched on by hand. duckbill normally costs well under
    // a dollar a month, so this catches a runaway schedule, loop or resource.
    // AWS emails when the month's actual or forecast spend passes the limit.
    // The first two budgets in an account are free.
    new budgets.CfnBudget(this, "Budget", {
      budget: {
        budgetName: `${PREFIX}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: "USD" },
      },
      notificationsWithSubscribers: ["ACTUAL", "FORECASTED"].map((notificationType) => ({
        notification: {
          notificationType,
          comparisonOperator: "GREATER_THAN",
          threshold: 100,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "EMAIL", address: props.alertEmail }],
      })),
    });

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "IngestFunctionName", { value: ingest.functionName });
    new CfnOutput(this, "DbtFunctionName", { value: dbt.functionName });
  }
}
