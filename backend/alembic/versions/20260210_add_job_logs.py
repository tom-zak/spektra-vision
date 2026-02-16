"""Add logs column to jobs table

Revision ID: 20260210_add_job_logs
Revises: 20260210_add_tags
Create Date: 2026-02-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260210_add_job_logs"
down_revision = "20260210_add_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("logs", postgresql.JSONB(), server_default="[]", nullable=False))


def downgrade() -> None:
    op.drop_column("jobs", "logs")
