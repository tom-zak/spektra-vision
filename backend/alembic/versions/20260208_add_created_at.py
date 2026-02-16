"""add created_at to images

Revision ID: 20260208_add_created_at
Revises: 20260208_add_is_prediction
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260208_add_created_at"
down_revision = "20260208_add_is_prediction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "images",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("images", "created_at")
