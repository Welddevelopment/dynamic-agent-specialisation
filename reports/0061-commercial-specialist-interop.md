# Commercial specialist host interoperability

Date: 2026-08-05

## Result

An activated specialist can now be invoked through three thin host boundaries without translating away its tested authority, memory, limits or independent verifier:

1. a direct JavaScript invoker;
2. a LangGraph-compatible asynchronous node; and
3. a transport-neutral MCP `tools/list` / `tools/call` adapter.

The external host supplies only a stable request id and an ordinary business goal. DAS retains the exact activated bundle, fixed tenant, customer-local tool binding and independent external-state verifier. The returned host receipt is sanitized and omits raw tool observations, credentials and customer records.

The invoker rejects a changed activation, wrong verifier, missing customer-local binding and conflicting reuse of one request id. Identical repeated requests in the same process return the original promise/result rather than executing the business action again.

## Framework boundaries

- LangGraph nodes are ordinary functions that receive state and return a partial state update. The implemented adapter follows that boundary while keeping the DAS runtime inside the node.
- MCP tools expose a name, description and input schema through `tools/list`, then accept execution through `tools/call`. The implemented adapter follows that tool contract and reports tool execution errors inside the result.
- CrewAI currently documents first-class MCP support. The interoperability manifest therefore describes CrewAI as `requires-customer-wiring` through MCP rather than claiming a tested native CrewAI package.

Primary references reviewed for this checkpoint:

- https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.StateGraph.html
- https://docs.crewai.com/
- https://modelcontextprotocol.io/specification/2025-06-18/server/tools

## Validation

- Four focused interoperability tests pass.
- Full local suite passes 166/166.
- The tests exercise direct invocation, same-process idempotency, conflicting request rejection, LangGraph state update, MCP discovery/call, extra-input rejection and activation-tamper rejection.
- No framework package, remote transport or paid model was installed or called.

## Boundary

This checkpoint implements the host contracts, not a remotely deployed MCP server, a durable post-restart request ledger or a customer-specific framework installation. Same-process duplicate suppression is real; post-restart unknown-state recovery remains a separate dependency. The next commercially relevant step is a customer-local authenticated sidecar with durable request state and safe restart behavior.
