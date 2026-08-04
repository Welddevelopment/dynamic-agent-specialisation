# Bounded MCP adapter kit

Many companies and software vendors already expose tools through MCP. DAS can now pin an exact reviewed subset of one customer-local MCP server and present it through the same bounded tool-host contract used by imported OpenAPI operations.

## Compile a local package

First save the exact `tools/list` response from the customer-controlled MCP transport. Create a JSON config that identifies the server and explicitly classifies each selected tool as read or write. Then run:

```sh
npm run adapter:mcp:compile -- ./tools-list.json ./adapter-config.json ./new-mcp-adapter
```

The output contains an integrity-bound adapter plan and refuses to overwrite an existing directory. It contains no credentials or MCP transport configuration.

## Safety boundary

- Unselected tools are unavailable to the specialist.
- Every write needs an explicit authority action.
- Every write schema must require a caller-supplied idempotency field.
- Every write needs a separately selected read tool, exact input mappings and external-state assertions for uncertain-outcome reconciliation.
- Runtime input is checked against a bounded pinned schema.
- Tool calls must return structured content; free-form text is not treated as verified state.
- The customer-local MCP transport continues to own server authentication and credentials.
- A separate goal-level external verifier and the ten-case customer-binding acceptance campaign are still required before controlled activation.

The MCP importer does not trust arbitrary tool servers, discover safe write semantics automatically, prove the server implementation, infer business success or establish customer/production reliability. It reduces repeated adapter engineering when a company already has a suitable MCP surface.

## Multi-system use

Bounded MCP and OpenAPI runtimes share one composition boundary. A specialist can use multiple systems in one run only when every tool name is unique, every component implements the full bounded runtime contract and an independent external-state view exists for the combined business outcome.
