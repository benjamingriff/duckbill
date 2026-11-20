// CDK entry point. Deploy with deploy/setup.sh, or directly:
//   pnpm --filter @duckbill/cdk cdk deploy -c alertEmail=you@example.com
// Account and region come from your AWS profile (CDK_DEFAULT_ACCOUNT/REGION).
import { App } from "aws-cdk-lib";
import { DuckbillStack } from "../lib/stack.ts";

const app = new App();
const alertEmail = app.node.tryGetContext("alertEmail");
if (typeof alertEmail !== "string" || !alertEmail.includes("@")) {
  throw new Error("Pass the alarm email address: -c alertEmail=you@example.com");
}

new DuckbillStack(app, "Duckbill", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  alertEmail,
  motherduckDatabase: app.node.tryGetContext("motherduckDatabase"),
});
