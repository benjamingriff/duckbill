import assert from "node:assert/strict";
import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { GithubDeployStack } from "./github.ts";

const env = { account: "123456789012", region: "eu-west-2" };
const props = {
  env,
  subjectPrefix: "repo:owner@1/duckbill@2",
  environment: "aws",
  dbtFunctionName: "duckbill-dbt",
};

test("only the repo's deploy environment can assume the role", () => {
  const template = Template.fromStack(new GithubDeployStack(new App(), "Test", props));
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "duckbill-github-deploy",
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub": "repo:owner@1/duckbill@2:environment:aws",
            },
          },
        },
      ],
    },
  });
});

test("the role can only reach the CDK bootstrap roles and start the dbt function", () => {
  const template = Template.fromStack(new GithubDeployStack(new App(), "Test", props));
  const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (p) => p.Properties.PolicyDocument.Statement,
  );
  assert.deepEqual(
    statements.map((s) => [s.Action, JSON.stringify(s.Resource)]),
    [
      [
        "sts:AssumeRole",
        JSON.stringify({
          "Fn::Join": [
            "",
            [
              "arn:",
              { Ref: "AWS::Partition" },
              ":iam::123456789012:role/cdk-hnb659fds-*-role-123456789012-eu-west-2",
            ],
          ],
        }),
      ],
      [
        "lambda:InvokeFunction",
        JSON.stringify({
          "Fn::Join": [
            "",
            [
              "arn:",
              { Ref: "AWS::Partition" },
              ":lambda:eu-west-2:123456789012:function:duckbill-dbt",
            ],
          ],
        }),
      ],
    ],
  );
});

test("an existing OIDC provider is reused instead of created", () => {
  const arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com";
  const template = Template.fromStack(
    new GithubDeployStack(new App(), "Test", { ...props, oidcProviderArn: arn }),
  );
  template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
  template.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: { Statement: [{ Principal: { Federated: arn } }] },
  });
});
