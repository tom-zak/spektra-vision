"""add version columns for optimistic locking

Revision ID: 20260208_add_versions
Revises: 20260208_expand_jobs
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260208_add_versions"
down_revision = "20260208_expand_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("images", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("annotations", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("annotations", "version")
    op.drop_column("images", "version")
    op.drop_column("projects", "version")
