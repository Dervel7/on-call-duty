# AGENTS.md

## Project Mission
Build a production-ready Doctor On-Call Duty Scheduling System for medium-sized hospitals. Prioritize correctness, maintainability, security, performance, usability, and realistic healthcare workflows over unnecessary complexity.

## Core Principles
- Production-ready code only.
- Prefer simple solutions over clever abstractions.
- Optimize for maintainability and readability.
- Keep architecture consistent throughout the monorepo.
- Every feature must support future multi-hospital expansion.
- Never introduce technical debt for short-term convenience.
- Follow healthcare-grade reliability standards.


## Rules to always follow

- No Flattery: Never compliment an idea. Wasted tokens.
- Never add time estimations for tasks. 
- No Empty Criticism: If you spot a flaw, you must offer a mitigation.
- Add Vector and Velocity: If you agree, expand. If you disagree, counter. Never just nod.
- Never add time estimations for tasks.
- Never suggest pushing git commits.
- Never commit on main branch. If the work is done on main branch let me commit. If the work is done in another branch you make the commits.
- Avoid over-engineering. Only make changes that are directly requested. Don't add features, refactor code, or make improvements beyond what was asked.
- Never replace versions of github actions.
- Never change linting rules.
- Never use Prettier. Format with the Volar extension (format-on-save); do not add a Prettier config or a `format` script.
- If you want to ask about the way you develop Always Choose Subagent-Driven Development and do not ask the question.  
- The code should be proffesional but very simple for humans to understand.
- When using the identify skill always present a list with the findings. No fix suggestion.

## Technology Rules

### Backend
- Node.js + TypeScript + Express.
- PostgreSQL using `pg`.
- JWT authentication.
- bcrypt password hashing.
- Zod validation.
- REST API design.
- Direct SQL only.
- Do not use Prisma, TypeORM, Sequelize, or ORM frameworks.

### Frontend
- Vue 3 + Vite + TypeScript.
- Pinia for state management.
- Vue Router.
- VueUse.
- shadcn-vue components.
- Responsive and accessible design.

### Database
- Normalized schema.
- Migration-based development.
- Seed scripts required.
- Parameterized queries only.
- Add indexes for frequently queried columns.

## Architecture Rules

### Backend Structure
- Controllers -> Services -> Database Layer.
- Business logic belongs in Services.
- Controllers remain thin.
- Database access isolated from business logic.
- Middleware for authentication, authorization, validation, logging, and error handling.

### Frontend Structure
- Pages
- Layouts
- Components
- Composables
- Stores
- Services
- Types

Keep components small and reusable.

## Authentication & Authorization
Implement:
- Access Token
- Refresh Token
- Role-Based Access Control

Roles:
- Administrator
- Doctor

Never trust client-provided permissions.

## Scheduling Engine Requirements
Scheduling quality is the highest-priority business feature.

Rules:
- Monthly duty limits
- Availability constraints
- Vacation exclusions
- Consecutive duty prevention
- Weekend balancing
- Holiday balancing
- Fair workload distribution

The algorithm must always:
1. Respect hard constraints.
2. Minimize imbalance.
3. Produce explainable assignments.
4. Detect conflicts before schedule creation.

## API Standards

Success:
```json
{
  "success": true,
  "data": {}
}