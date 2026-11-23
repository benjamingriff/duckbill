import {
  ArnFormat,
  CfnOutput,
  DefaultStackSynthesizer,
  Duration,
  Stack,
  type StackProps,
  aws_iam as iam,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

const GITHUB_OIDC = "token.actions.githubusercontent.com";

export interface GithubDeployStackProps extends StackProps {
  // How GitHub names the repository in the token's subject, before
  // ":environment:…". With GitHub's immutable subjects (the default for new
  // repos) it carries the owner and repo IDs: repo:owner@123/name@456. The
  // classic form is repo:owner/name. GitHub's API reports which one a repo uses:
  // repos/<owner>/<name>/actions/oidc/customization/sub.
  subjectPrefix: string;
  // GitHub environment the deploy job runs in; only main can use it.
  environment: string;
  // An account has one GitHub OIDC provider. Pass its ARN if it exists already.
  oidcProviderArn?: string;
  // The function the workflow rebuilds with after a deploy.
  dbtFunctionName: string;
}

/**
 * The role the "Deploy AWS" workflow (.github/workflows/deploy-aws.yml) assumes
 * through GitHub's OIDC provider, so GitHub stores no AWS keys. Only a job in
 * the repo's deploy environment, which only main may use, can assume it. The
 * role can hand off to the CDK bootstrap roles (all `cdk deploy` needs) and
 * start the dbt function. deploy/github-setup.sh deploys this stack from your
 * machine.
 *
 * CDK's default bootstrap deploys through a CloudFormation role with
 * AdministratorAccess, so whatever is on main can change anything in the
 * account, as a deploy from your machine can. What guards it is main's ruleset:
 * code reaches main only through a pull request whose CI passes.
 */
export class GithubDeployStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubDeployStackProps) {
    super(scope, id, props);

    const providerArn = props.oidcProviderArn
      ? props.oidcProviderArn
      : new iam.OidcProviderNative(this, "Provider", {
          url: `https://${GITHUB_OIDC}`,
          clientIds: ["sts.amazonaws.com"],
        }).oidcProviderArn;

    const role = new iam.Role(this, "Role", {
      roleName: "duckbill-github-deploy",
      description: `GitHub Actions: ${props.subjectPrefix}, ${props.environment} environment`,
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_OIDC}:sub`]: `${props.subjectPrefix}:environment:${props.environment}`,
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    const qualifier = DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:${this.partition}:iam::${this.account}:role/cdk-${qualifier}-*-role-${this.account}-${this.region}`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          this.formatArn({
            service: "lambda",
            resource: "function",
            resourceName: props.dbtFunctionName,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
      }),
    );

    new CfnOutput(this, "RoleArn", { value: role.roleArn });
  }
}
