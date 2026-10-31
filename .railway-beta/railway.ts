import { defineRailway, project, service } from "railway/iac";

// Kept outside .railway/ because the CLI reads one authoring file per directory; pass it with --file.
// Beta has no repo connected and deploys only through `railway up`, so it declares no source.
export const partial = "globalise-mcp-beta";

export default defineRailway(() => {
  const globaliseMcpBeta = service("globalise-mcp-beta", {
    // Must stay top-level: `source: { rootDirectory }` plans as clearing it, and the repo root has no package.json.
    rootDirectory: "/globalise-mcp-server",
    build: { buildCommand: "npm run build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/globalise-mcp-server/**"] },
    start: "node dist/index.js",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { limitOverride: { containers: { cpu: 24, memoryBytes: 1000000000 } }, sleepApplication: true, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
  });
  return project("endearing-warmth", {
    variables: { managed: false },
    resources: [globaliseMcpBeta],
  });
});
