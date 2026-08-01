# Competitive benchmark protocol

Last primary-source review: 2026-08-02.

This document defines comparisons; it does not claim that the current deterministic reference has beaten any external system.

## Categories must remain separate

### Construction runtimes

- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) supplies an agent loop, tools, guardrails, sessions, handoffs, tracing, and orchestration patterns. Its agent definition centers on a model configured with instructions, tools, and optional runtime behavior.
- [CrewAI](https://docs.crewai.com/) supplies agents, crews, flows, tasks, tools, memory, knowledge, guardrails, and deployment/observability surfaces.
- LangChain supplies agent construction primitives; [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation) supplies offline/online datasets, evaluators, experiments, monitoring, and feedback loops.

These are not one algorithms that can be “beaten” with a single score. Build representative agents through each applicable workflow and record the human configuration they require.

### Optimizers

- [DSPy](https://dspy.ai/) defines signatures/modules and optimizes programs against examples and a scoring metric. It is a serious direct component baseline for prompt/program optimization.

DSPy must receive the same development data and metric. Compare both outcome quality and which specialist dimensions each system searches.

### Evaluation products

- [Microsoft Copilot Studio agent evaluation](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/analytics-agent-evaluation-intro) supports repeatable test conversations, evaluation methods, authenticated user profiles, version comparison, and iterative configuration changes.
- [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation) supports code, human, LLM, and pairwise evaluators, repeated experiments, and online monitoring.

Evaluation infrastructure is not automatically a specialist compiler. The fair comparison is the complete public workflow: a human creates/configures variants, runs evaluation, interprets results, and edits the agent.

## Fixed comparison dimensions

For every runnable baseline record:

1. Input information supplied.
2. Human configuration time.
3. Human decisions and edits.
4. Search dimensions: model, instructions, context, tools, memory, authority, escalation, verifier, cost, latency.
5. Development and validation calls.
6. Frozen unseen outcome success.
7. Incorrect external effects and authority violations.
8. Correct and unnecessary escalations.
9. Model cost and latency.
10. Reproducibility and evidence visibility.

## Claim rule

Permitted future wording must remain bounded, for example:

> In these three frozen synthetic business roles, the compiler produced specialists with X outcome score using Y measured human configuration, compared with the tested representative workflows.

Never convert that into “better than LangChain,” “better than Microsoft,” or a company-wide superiority statement.

