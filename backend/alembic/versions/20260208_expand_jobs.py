"""expand jobs table

add project_id, job_type, model_arch, hyperparams, artifact_path, created_at columns
"""

revision = "20260208_expand_jobs"
down_revision = "20260208_add_created_at"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


def upgrade() -> None:
    op.add_column("jobs", sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=True))
    op.add_column("jobs", sa.Column("job_type", sa.String(50), nullable=True, server_default="train"))
    op.add_column("jobs", sa.Column("model_arch", sa.String(255), nullable=True))
    op.add_column("jobs", sa.Column("hyperparams", JSONB, nullable=True, server_default="{}"))
    op.add_column("jobs", sa.Column("artifact_path", sa.String(1024), nullable=True))
    op.add_column("jobs", sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()))

    # Backfill defaults
    op.execute("UPDATE jobs SET job_type = 'train' WHERE job_type IS NULL")
    op.execute("UPDATE jobs SET hyperparams = '{}' WHERE hyperparams IS NULL")

    op.alter_column("jobs", "job_type", nullable=False)


def downgrade() -> None:
    op.drop_column("jobs", "created_at")
    op.drop_column("jobs", "artifact_path")
    op.drop_column("jobs", "hyperparams")
    op.drop_column("jobs", "model_arch")
    op.drop_column("jobs", "job_type")
    op.drop_column("jobs", "project_id")
