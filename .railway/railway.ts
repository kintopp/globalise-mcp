import { defineRailway, github, project, service } from "railway/iac";

// The project is shared with other repos' services; the partial limits this file to its own.
export const partial = "globalise-mcp";

export default defineRailway(() => {
  const globaliseMcp = service("globalise-mcp", {
    source: github("kintopp/globalise-mcp", { branch: "main", checkSuites: false, rootDirectory: "/globalise-mcp-server" }),
    build: { buildCommand: "npm run build", buildEnvironment: "V3", builder: "RAILPACK", watchPatterns: ["/globalise-mcp-server/src/**", "/globalise-mcp-server/*.json", "/globalise-mcp-server/apps/**", "/globalise-mcp-server/scripts/**", "/globalise-mcp-server/data/**"] },
    start: "node dist/index.js",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { limitOverride: { containers: { cpu: 24, memoryBytes: 1000000000 } }, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
  });
  return project("endearing-warmth", {
    variables: { managed: false },
    resources: [globaliseMcp],
  });
});
