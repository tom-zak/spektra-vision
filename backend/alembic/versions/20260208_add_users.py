"""add users table

Revision ID: 20260208_add_users
Revises: 20260208_add_history
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260208_add_users"
down_revision = "20260208_add_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use DO block so it's idempotent on re-run
    op.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN CREATE TYPE user_role AS ENUM ('ADMIN', 'ANNOTATOR', 'REVIEWER'); END IF; END $$")
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), unique=True, nullable=False, index=True),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column("role", postgresql.ENUM("ADMIN", "ANNOTATOR", "REVIEWER", name="user_role", create_type=False), nullable=False, server_default="ANNOTATOR"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("users")
    op.execute("DROP TYPE user_role")
