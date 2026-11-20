import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
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

export interface DuckbillStackProps extends StackProps {
  // Where failure alarms are emailed. AWS sends a confirmation email first.
  alertEmail: string;
  // MotherDuck database the dbt function publishes into.
  motherduckDatabase?: string;
}

/**
 * Everything duckbill runs in AWS: the raw bucket, the daily ingest function
 * (the only holder of the Monzo token), the dbt function that publishes to
 * MotherDuck, and failure alarms. The web app runs elsewhere (Railway).
 */
export class DuckbillStack extends Stack {
  constructor(scope: Construct, id: string, props: DuckbillStackProps) {
    super(scope, id, props);

    // Raw files are the only copy of history older than Monzo's 90 days, so
    // the bucket is versioned and survives the stack being deleted.
    const bucket = new s3.Bucket(this, "Raw", {
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
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    const parameterArn = (name: string) =>
      this.formatArn({ service: "ssm", resource: "parameter", resourceName: name.slice(1) });

    const dbt = new lambda.DockerImageFunction(this, "Dbt", {
      description: "dbt build from raw in S3, publish to MotherDuck",
      code: image("duckbill_ingest.aws.dbt_handler"),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      ephemeralStorageSize: Size.mebibytes(1024),
      timeout: Duration.minutes(10),
      retryAttempts: 0,
      logGroup: logGroup("Dbt"),
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

    // One run a day, never concurrent: Monzo refresh tokens are single use,
    // so two overlapping runs could break each other's token chain.
    const ingest = new lambda.DockerImageFunction(this, "Ingest", {
      description: "Daily Monzo sync into S3, then starts the dbt function",
      code: image("duckbill_ingest.aws.ingest_handler"),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: Duration.minutes(5),
      retryAttempts: 1,
      logGroup: logGroup("Ingest"),
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
      description: "Run the duckbill ingest every morning",
      schedule: events.Schedule.cron({ minute: "0", hour: "5" }),
      targets: [new targets.LambdaFunction(ingest)],
    });

    const alerts = new sns.Topic(this, "Alerts");
    alerts.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    const alarm = (id: string, metric: cloudwatch.Metric, description: string) => {
      new cloudwatch.Alarm(this, id, {
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
      ingest.metricErrors(daily),
      "Monzo sync failed. If the logs say the token can't be refreshed, run `duckbill login`.",
    );
    alarm("DbtFailed", dbt.metricErrors(daily), "dbt build or MotherDuck publish failed.");
    new cloudwatch.Alarm(this, "IngestDidNotRun", {
      metric: ingest.metricInvocations(daily),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: "The daily Monzo sync hasn't run for two days.",
    }).addAlarmAction(new actions.SnsAction(alerts));

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "IngestFunctionName", { value: ingest.functionName });
    new CfnOutput(this, "DbtFunctionName", { value: dbt.functionName });
  }
}
