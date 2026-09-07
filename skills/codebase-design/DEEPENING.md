# Deepening: Dependency Categories and Seam Discipline

How to deepen a cluster of shallow modules into high-leverage architectural components.

## Dependency Categories

When assessing a module or candidate for deepening, classify its dependencies. The category dictates how the module is structured and tested across its seams:

### 1. In-Process (Pure Computation)

- **Characteristics:** In-memory state, algorithms, data transformations, zero network/disk I/O.
- **Deepening Strategy:** Merge shallow helpers and test directly through the deep module interface. No adapters, mocks, or ports needed.

### 2. Local-Substitutable

- **Characteristics:** Infrastructure dependencies with reliable in-memory or embedded substitutes (e.g. SQLite in `:memory:`, PGLite, in-memory filesystem, mock clock).
- **Deepening Strategy:** Deepen the module and run tests directly against the local substitute. The seam remains internal to the module; callers never configure or pass database handles.

### 3. Remote but Owned (Ports & Adapters)

- **Characteristics:** Internal microservices, background job queues, or intra-company APIs deployed across network boundaries.
- **Deepening Strategy:** Define a clean **port** (interface) at the seam. The deep module owns domain orchestration; the transport is injected via an **adapter**. Tests supply a fast in-memory adapter; production supplies an HTTP/gRPC/queue adapter.

### 4. True External (Third-Party Services)

- **Characteristics:** External vendors (Stripe, Twilio, SendGrid, AWS S3) outside your control.
- **Deepening Strategy:** The module defines a narrow domain port. Test suites supply a mock/stub adapter verifying request shapes; production supplies the vendor client adapter.

---

## Seam Discipline

- **The Two-Adapter Rule:** One adapter means a hypothetical seam; two adapters means a real one. Do NOT introduce an interface or port unless at least two implementations are justified (typically production + in-memory test). A single-implementation interface is unnecessary indirection.
- **Internal vs External Seams:** A deep module may have internal seams (private helpers, internal storage engines) for its own tests. Do not leak internal seams to external callers.
- **The Interface is the Test Surface:** Write unit tests against the deep module interface, not against internal private functions. Tests survive internal refactoring when they test behavior, not implementation mechanics.
