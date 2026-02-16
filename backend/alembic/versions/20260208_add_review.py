"""add review fields to images

Revision ID: 20260208_add_review
Revises: 20260208_add_users
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260208_add_review"
down_revision = "20260208_add_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status') THEN CREATE TYPE review_status AS ENUM ('UNREVIEWED', 'APPROVED', 'REJECTED', 'NEEDS_REVISION'); END IF; END $$")
    op.add_column("images", sa.Column("review_status", postgresql.ENUM("UNREVIEWED", "APPROVED", "REJECTED", "NEEDS_REVISION", name="review_status", create_type=False), server_default="UNREVIEWED", nullable=False))
    op.add_column("images", sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("images", sa.Column("review_comment", sa.String(2000), nullable=True))


def downgrade() -> None:
    op.drop_column("images", "review_comment")
    op.drop_column("images", "reviewed_by")
    op.drop_column("images", "review_status")
    op.execute("DROP TYPE review_status")
