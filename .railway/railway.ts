// Railway infrastructure for the web app: one service, the Hono API plus the
// built dashboard (deploy/railway/Dockerfile). Railway doesn't read this file on
// deploy; apply changes from the repo root with `railway config plan`, then
// `railway config apply`. deploy/setup.sh does the first apply.
//
// Two things live outside this file, both set by deploy/setup.sh:
// - Variables. They're unmanaged, so applies never read or write them and the
//   secrets (MOTHERDUCK_TOKEN, CLERK_SECRET_KEY) never touch the repo.
// - The generated *.up.railway.app domain, which Railway leaves out of IaC.
import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("duckbill", {
    source: github("benjamingriff/duckbill", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "deploy/railway/Dockerfile",
      // Only redeploy when the image's inputs change, not on ingest or dbt edits.
      watchPatterns: [
        "apps/**",
        "deploy/railway/**",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.base.json",
        ".dockerignore",
      ],
    },
    deploy: {
      healthcheckPath: "/healthz",
      restartPolicyType: "ON_FAILURE",
    },
  });

  return project("duckbill", {
    // The CLI reads `variables` ({ managed, ignore }), but SDK 3.17's types
    // don't declare it yet; the spread keeps the excess-property check quiet.
    ...unmanagedVariables,
    resources: [web],
  });
});

const unmanagedVariables = { variables: { managed: false, ignore: [] as string[] } };
