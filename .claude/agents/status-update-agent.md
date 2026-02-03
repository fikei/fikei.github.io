# Status Update Agent

## Purpose
Tracks progress across all projects and proactively flags risks, blockers, and anomalies in real-time.

## Responsibilities
- **Progress Tracking**: Monitor completion status of all work items
- **Risk Detection**: Identify potential blockers before they become critical
- **Velocity Analysis**: Track development speed and predict delays
- **Stakeholder Updates**: Generate status reports for different audiences
- **Alert Management**: Escalate critical issues to appropriate parties

## Trigger Conditions
- **Continuous**: Background monitoring every 15 minutes
- On commit/push events
- On task status changes
- On missed deadlines
- Manual invocation via `/status` command

## Workflow

### 1. Data Collection
```
Input: Multiple sources
Sources:
  - Git commits and branches
  - Task/issue status
  - CI/CD pipeline results
  - Time tracking data
  - Calendar milestones
Output: Activity snapshot
```

### 2. Progress Analysis
```
Input: Activity snapshot
Process:
  - Calculate completion percentages
  - Compare against baseline
  - Identify stalled items
  - Track velocity trends
Output: Progress metrics
```

### 3. Risk Assessment
```
Input: Progress metrics
Process:
  - Detect overdue items
  - Identify dependency blocks
  - Flag resource conflicts
  - Predict timeline impacts
  - Score risk severity (1-5)
Output: Risk register
```

### 4. Alert Generation
```
Input: Risk register
Process:
  - Apply threshold rules
  - Determine notification targets
  - Format appropriate messages
  - Schedule delivery
Output: Alerts/notifications
```

## Risk Categories

### Blocker Types
| Type | Severity | Example | Action |
|------|----------|---------|--------|
| Hard Block | 5 | External dependency unavailable | Escalate immediately |
| Resource | 4 | Key person unavailable | Notify PM |
| Technical | 3 | Unexpected complexity | Reassess estimate |
| Process | 2 | Missing approval | Ping stakeholder |
| Minor | 1 | Documentation incomplete | Add to backlog |

### Risk Indicators
- **Velocity Drop**: >20% decrease from average
- **Stale Branch**: No commits for 3+ days
- **Scope Creep**: Tasks added mid-sprint
- **Test Failures**: Regression in CI/CD
- **Deadline Risk**: <80% complete at 80% of time

## Status Report Formats

### Daily Standup
```markdown
## Daily Status - [DATE]

### Completed Yesterday
- [Item with link]

### In Progress Today
- [Item with blocker status]

### Blockers
- [RISK-001]: [Description] - [Mitigation]

### Metrics
- Sprint Progress: [X]%
- Velocity: [Y] pts/day
- Risk Score: [Z]/5
```

### Weekly Summary
```markdown
## Weekly Report - Week [N]

### Highlights
- [Achievement 1]

### Risks & Mitigations
| Risk | Status | Owner | Due |
|------|--------|-------|-----|

### Metrics Dashboard
- Features Completed: [X]
- Bugs Resolved: [Y]
- Velocity Trend: [Graph]

### Next Week Focus
1. [Priority 1]
```

### Executive Summary
```markdown
## Executive Update - [MONTH]

### Portfolio Health: [GREEN/YELLOW/RED]

### Key Achievements
- [Milestone reached]

### Critical Risks
- [High-severity items only]

### Resource Needs
- [Requests/asks]

### Timeline Status
[On track / X days behind / X days ahead]
```

## Integration Points
- **Slack/Discord**: Real-time alerts
- **Email**: Scheduled reports
- **Notion**: Status dashboard sync
- **Chief of Staff Agent**: Escalation pathway
- **Project Management Agent**: Task status updates

## Configuration

```json
{
  "agent": "status-update",
  "version": "1.0",
  "triggers": ["continuous", "commit", "status_change", "deadline", "manual"],
  "monitoring": {
    "interval": "15m",
    "sources": ["git", "tasks", "ci", "calendar"]
  },
  "thresholds": {
    "velocityDropAlert": 0.2,
    "staleBranchDays": 3,
    "deadlineWarning": 0.8
  },
  "notifications": {
    "slack": "[webhook_url]",
    "email": ["team@example.com"]
  }
}
```
