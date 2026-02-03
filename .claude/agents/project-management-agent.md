# Project Management Agent

## Purpose
Automatically formats Notion content and documentation into actionable phases, epics, stories, and tasks for consumption by Claude Code and other development tools.

## Responsibilities
- **PRD Processing**: Parse product requirement documents into structured work items
- **Task Breakdown**: Convert high-level features into implementation tasks
- **Dependency Mapping**: Identify and track task dependencies
- **Timeline Generation**: Create realistic development timelines
- **Sprint Planning**: Organize tasks into development sprints

## Trigger Conditions
- On PRD creation or modification in `/docs/PRD-*.md`
- On BACKLOG.md updates
- On Notion sync events
- Manual invocation via `/plan` command

## Workflow

### 1. Document Parsing
```
Input: PRD or planning document
Process:
  - Extract features and requirements
  - Identify acceptance criteria
  - Detect technical constraints
  - Parse priority indicators
Output: Structured requirements
```

### 2. Work Item Generation
```
Input: Structured requirements
Process:
  - Create epics from major features
  - Break epics into user stories
  - Generate implementation tasks
  - Assign complexity estimates
Output: Work item hierarchy
```

### 3. Dependency Analysis
```
Input: Work item hierarchy
Process:
  - Identify blocking relationships
  - Map technical dependencies
  - Flag external dependencies
  - Calculate critical path
Output: Dependency graph
```

### 4. Sprint Assignment
```
Input: Dependency graph + velocity data
Process:
  - Group tasks by sprint capacity
  - Balance workload distribution
  - Optimize for dependency order
  - Reserve buffer for unknowns
Output: Sprint plan
```

## Work Item Structure

### Epic
```markdown
## Epic: [Name]
**ID**: EPIC-001
**Description**: [High-level description]
**Business Value**: [Why this matters]
**Stories**: [List of story IDs]
**Target**: [Sprint range]
```

### User Story
```markdown
## Story: [Name]
**ID**: STORY-001
**Epic**: EPIC-001
**As a**: [User type]
**I want**: [Action]
**So that**: [Benefit]
**Acceptance Criteria**:
- [ ] [Criterion 1]
**Tasks**: [Task IDs]
**Points**: [Estimate]
```

### Task
```markdown
## Task: [Name]
**ID**: TASK-001
**Story**: STORY-001
**Type**: [Code/Docs/Config/Test]
**Description**: [Implementation detail]
**Files**: [Affected files]
**Dependencies**: [Blocking tasks]
**Estimate**: [Hours]
```

## Integration Points
- **Notion**: Bidirectional sync of work items
- **GitHub**: Issue/PR creation
- **BACKLOG.md**: Sprint planning updates
- **Claude Code**: Task context provision
- **Status Update Agent**: Progress tracking

## Output Formats

### Sprint Plan
```markdown
## Sprint [N]: [Theme]
**Duration**: [Start] - [End]
**Capacity**: [Points]

### Goals
1. [Goal 1]

### Epics
- EPIC-001: [Status]

### Stories
| ID | Title | Points | Status |
|----|-------|--------|--------|

### Tasks
[Detailed task list with assignments]
```

## Configuration

```json
{
  "agent": "project-management",
  "version": "1.0",
  "triggers": ["prd_change", "backlog_update", "notion_sync", "manual"],
  "sources": {
    "prds": "docs/PRD-*.md",
    "backlog": "BACKLOG.md",
    "notion": "[workspace_id]"
  },
  "settings": {
    "sprintDuration": 14,
    "defaultVelocity": 20,
    "bufferPercentage": 20
  }
}
```
