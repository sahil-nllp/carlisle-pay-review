"""Add is_excluded to employees.

Allows HR admins to exclude an employee from the review cycle
(e.g. on leave, contractor, duplicate) without deleting their record.
Excluded employees are grayed-out / read-only in the UI and not counted
in payroll stats or compliance aggregates.

Revision ID: a1b2c3d4e5f6
Revises: 7c4a91f02e10
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "7c4a91f02e10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column(
            "is_excluded",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("employees", "is_excluded")
