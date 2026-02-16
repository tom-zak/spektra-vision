"""add is_prediction to annotations

Revision ID: 20260208_add_is_prediction
Revises: 
Create Date: 2026-02-08 00:00:00
"""

from alembic import op
import sqlalchemy as sa

revision = "20260208_add_is_prediction"
down_revision = "20260208_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("annotations", sa.Column("is_prediction", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("annotations", "is_prediction", server_default=None)


def downgrade() -> None:
    op.drop_column("annotations", "is_prediction")
