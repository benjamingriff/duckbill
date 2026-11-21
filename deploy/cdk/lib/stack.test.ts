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
  const roleRef = template.findResources("AWS::Lambda::Function")[
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
