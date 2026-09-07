# CONTEXT.md Format

A project glossary establishing ubiquitous language for the bounded context.

## Structure

```markdown
# {Context Name}

{One or two sentence description of what this bounded context is and why it exists.}

## Ubiquitous Language

**Order**:
A customer request to purchase goods, created at checkout and tracked through fulfillment.
_Avoid_: Purchase, Transaction, Cart.

**Invoice**:
A formal request for payment issued to a customer with payment terms and due dates.
_Avoid_: Bill, Receipt.

**Customer**:
A person or legal entity holding an active account that places orders.
_Avoid_: User, Client, Buyer.
```

## Rules

- **Be Opinionated:** When multiple words exist for the same concept, designate the canonical term and list confusing alternatives under `_Avoid_`.
- **Keep Definitions Tight:** 1 to 2 sentences max. Define what the concept IS, not how it is implemented in code.
- **Domain Concepts Only:** General programming concepts (buffers, queues, retries, JSON schemas) do NOT belong here unless they are domain entities within the system.
- **No Implementation Artifacts:** Do not put task lists, scratchpads, or pseudo-code in `CONTEXT.md`.
