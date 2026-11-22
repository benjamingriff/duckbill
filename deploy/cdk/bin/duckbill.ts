// CDK entry point. Two stacks:
//   Duckbill        the app. The "Deploy AWS" workflow deploys it from main;
//                   deploy/setup.sh does the first deploy.
//   DuckbillGithub  the role that workflow uses. Deploy it from your machine
//                   with deploy/github-setup.sh, never from GitHub.
// Directly: pnpm --filter @duckbill/cdk exec cdk deploy <stack> -c alertEmail=you@example.com
// Account and region come from your AWS profile (CDK_DEFAULT_ACCOUNT/REGION).
// Optional context: motherduckDatabase, and for DuckbillGithub githubRepo
// (default benjamingriff/duckbill) and githubOidcProviderArn (when the account
// already has GitHub's OIDC provider).
import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { GithubDeployStack } from "../lib/github.ts";
import { DBT_FUNCTION_NAME, DuckbillStack } from "../lib/stack.ts";

const app = new App();
const alertEmail = app.node.tryGetContext("alertEmail");
if (typeof alertEmail !== "string" || !alertEmail.includes("@")) {
  throw new Error("Pass the alarm email address: -c alertEmail=you@example.com");
}
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new DuckbillStack(app, "Duckbill", {
  env,
  // Every CDK app in the account shares the bootstrap ECR repository. The prefix
  // lets deploy/setup.sh's lifecycle rule expire old duckbill images only.
  synthesizer: new DefaultStackSynthesizer({ dockerTagPrefix: "duckbill-" }),
  alertEmail,
  motherduckDatabase: app.node.tryGetContext("motherduckDatabase"),
});

new GithubDeployStack(app, "DuckbillGithub", {
  env,
  repo: app.node.tryGetContext("githubRepo") ?? "benjamingriff/duckbill",
  // Must match `environment:` in .github/workflows/deploy-aws.yml.
  environment: "aws",
  oidcProviderArn: app.node.tryGetContext("githubOidcProviderArn"),
  dbtFunctionName: DBT_FUNCTION_NAME,
});
