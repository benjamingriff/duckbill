import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { DuckbillStack } from "./stack.ts";

const template = Template.fromStack(
  new DuckbillStack(new App(), "Test", {
    env: { account: "123456789012", region: "eu-west-2" },
    alertEmail: "alerts@example.com",
  }),
);

// Parameter names each function's role may call `action` on.
function parametersAllowed(functionId: string, action: string): string[] {
  const roleRef =
    template.findResources("AWS::Lambda::Function")[
      Object.keys(template.findResources("AWS::Lambda::Function")).find((id) =>
        id.startsWith(functionId),
      )!
    ]!.Properties.Role["Fn::GetAtt"][0];
  const policies = Object.values(template.findResources("AWS::IAM::Policy")).filter((p) =>
    p.Properties.Roles.some((r: { Ref: string }) => r.Ref === roleRef),
  );
  return policies
    .flatMap((p) => p.Properties.PolicyDocument.Statement)
    .filter((s) => [s.Action].flat().includes(action))
    .flatMap((s) => [s.Resource].flat())
    .map((arn) => JSON.stringify(arn).match(/parameter(\/duckbill\/[a-z-]+)/)?.[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

test("only the ingest function can read or rewrite the Monzo token", () => {
  assert.deepEqual(parametersAllowed("Ingest", "ssm:PutParameter"), ["/duckbill/monzo-token"]);
  assert.deepEqual(parametersAllowed("Ingest", "ssm:GetParameter"), [
    "/duckbill/monzo-client",
    "/duckbill/monzo-token",
  ]);
  assert.deepEqual(parametersAllowed("Dbt", "ssm:GetParameter"), ["/duckbill/motherduck-token"]);
  assert.deepEqual(parametersAllowed("Dbt", "ssm:PutParameter"), []);
});

test("the raw bucket is private, versioned and kept if the stack is deleted", () => {
  template.hasResource("AWS::S3::Bucket", {
    DeletionPolicy: "Retain",
    Properties: {
      VersioningConfiguration: { Status: "Enabled" },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    },
  });
});

test("resources have readable names, not generated ones", () => {
  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketName: "duckbill-raw-123456789012-eu-west-2",
  });
  for (const name of ["duckbill-ingest", "duckbill-dbt"]) {
    template.hasResourceProperties("AWS::Lambda::Function", { FunctionName: name });
    template.hasResourceProperties("AWS::IAM::Role", { RoleName: name });
    template.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: `/aws/lambda/${name}` });
  }
  template.hasResourceProperties("AWS::SNS::Topic", { TopicName: "duckbill-alerts" });
});

test("the raw bucket keeps its logical ID, so a deploy can't swap in an empty one", () => {
  // A new logical ID makes CloudFormation create a new, empty bucket under the
  // same name pattern and orphan the old one (it's retained, not deleted). That
  // would silently cut every run off from history.
  assert.deepEqual(Object.keys(template.findResources("AWS::S3::Bucket")), ["Raw72517081"]);
});

// Changing any of these changes what duckbill costs or how often it touches
// Monzo. Update the numbers here deliberately, and say so in the PR.
test("cost-relevant settings only change on purpose", () => {
  template.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "cron(0 5 * * ? *)" });
  template.hasResourceProperties("AWS::Lambda::Function", {
    FunctionName: "duckbill-ingest",
    MemorySize: 512,
    Timeout: 300,
  });
  template.hasResourceProperties("AWS::Lambda::Function", {
    FunctionName: "duckbill-dbt",
    MemorySize: 2048,
    Timeout: 600,
    EphemeralStorage: { Size: 1024 },
  });
  const retries = Object.values(template.findResources("AWS::Lambda::EventInvokeConfig"))
    .map((r) => r.Properties.MaximumRetryAttempts)
    .sort();
  assert.deepEqual(retries, [0, 1]);
  template.hasResourceProperties("AWS::Budgets::Budget", {
    Budget: { BudgetName: "duckbill-monthly", BudgetLimit: { Amount: 5, Unit: "USD" } },
  });
});
