<!--
TEMPLATE for a new agent skill.

Copy this directory to skills/agent/<name>/SKILL.md and edit. The bundle is read
from skills/agent/, one directory per skill, each with a SKILL.md.

COPY THIS DIRECTORY. Do not nest a skill inside a skill: skills/agent/foo/skill/
makes skill lookup ambiguous, and ambiguity here means an agent silently runs
without the rules it was supposed to have.
-->
# <Skill name, title case>

<One sentence: what this skill is for and when an agent should follow it.>

## The rules

1. <A rule that is checkable. "Do not X" is better than "be careful with X".>
2. ...

## Why

<Two or three sentences on the failure this prevents. An agent follows rules it
understands the reason for far more reliably than rules it does not - and a rule
whose reason you cannot state in a sentence is probably a preference, not a
rule.>

## Length

These are injected into an agent's instructions on every single job. Keep each
skill under about 40 lines. A skill nobody finishes reading is not a skill, and
the context it costs is taken from the job itself.
