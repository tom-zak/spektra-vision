"""add celery_task_id and CANCELLED status to jobs

Adds celery_task_id column and extends job status enum with CANCELLED.
"""

revision = "20260209_celery_task_id"
down_revision = "20260208_dataset_mgmt"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column("jobs", sa.Column("celery_task_id", sa.String(255), nullable=True))
    # Add CANCELLED to the jobstatus enum
    op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'CANCELLED'")


def downgrade() -> None:
    op.drop_column("jobs", "celery_task_id")
