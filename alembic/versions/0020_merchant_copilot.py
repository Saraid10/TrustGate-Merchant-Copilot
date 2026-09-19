"""Group merchant copilot purchases into a basket, and record Paytm orders.

Three tables beside the authorization core, none of which change it. A basket is one merchant goal;
its lines are ordinary single-item purchase requests, so policy, delegation, approval, and checkout
authority are reached by exactly the path they already have.

**A line holds a request or a rejection, never both, never neither.** A poisoned line is refused
before any payment request row exists, because the catalogue path rejects it on the way in. Storing
that as a nullable request id with a nullable reason beside it invites a third state that means
nothing, so the CHECK forbids it rather than trusting the writer.

**One Paytm order per checkout authority**, as a unique constraint rather than a lookup before
insert. Two concurrent dispatches both reading "no order yet" is precisely the race a unique index
exists to lose, and the Razorpay table has held the same constraint since migration 0009.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0020_merchant_copilot"
down_revision: str | None = "0019_authority_facts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A purchase made by the merchant copilot is a distinct origin, so the evidence should say so
    # rather than borrow one of the existing names. The column is constrained by an enumeration,
    # which is why a new source is a migration and not just a string the application passes.
    op.drop_constraint("ck_payment_request_source", "payment_request", type_="check")
    op.create_check_constraint(
        "ck_payment_request_source",
        "payment_request",
        "source IN ('API', 'MCP_AGENT', 'ATTACK_HARNESS', 'MERCHANT_COPILOT')",
    )

    op.create_table(
        "basket",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("assistant_mode", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenant.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("tenant_id", "id", name="uq_basket_tenant"),
        sa.CheckConstraint("char_length(goal) BETWEEN 1 AND 300", name="ck_basket_goal_length"),
        sa.CheckConstraint(
            "assistant_mode IN ('LIVE', 'OFFLINE', 'COMPROMISED')",
            name="ck_basket_assistant_mode",
        ),
    )

    op.create_table(
        "basket_line",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("basket_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("proposed", postgresql.JSONB(), nullable=False),
        sa.Column("discarded", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("payment_request_id", sa.Uuid(), nullable=True),
        sa.Column("rejection_reason", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "basket_id"],
            ["basket.tenant_id", "basket.id"],
            name="fk_basket_line_basket_tenant",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "payment_request_id"],
            ["payment_request.tenant_id", "payment_request.id"],
            name="fk_basket_line_request_tenant",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("basket_id", "position", name="uq_basket_line_position"),
        sa.CheckConstraint(
            "(payment_request_id IS NULL) <> (rejection_reason IS NULL)",
            name="ck_basket_line_request_xor_rejection",
        ),
    )
    op.create_index("ix_basket_line_basket", "basket_line", ["tenant_id", "basket_id"])

    op.create_table(
        "paytm_order",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("payment_id", sa.Uuid(), nullable=False),
        sa.Column("checkout_authority_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.String(length=50), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="CREATED"),
        sa.Column("paytm_txn_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id", "payment_id"],
            ["payment.tenant_id", "payment.id"],
            name="fk_paytm_order_payment_tenant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "checkout_authority_id"],
            ["checkout_authority.tenant_id", "checkout_authority.id"],
            name="fk_paytm_order_authority_tenant",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("order_id", name="uq_paytm_order_order_id"),
        sa.UniqueConstraint(
            "tenant_id", "checkout_authority_id", name="uq_paytm_order_one_per_authority"
        ),
        sa.CheckConstraint("amount_minor > 0", name="ck_paytm_order_amount_positive"),
        sa.CheckConstraint(
            "status IN ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'MISMATCH')",
            name="ck_paytm_order_status",
        ),
        sa.CheckConstraint(
            "order_id ~ '^[A-Za-z0-9]{1,50}$'", name="ck_paytm_order_id_alphanumeric"
        ),
    )


def downgrade() -> None:
    # Fails if any copilot purchase still exists, which is correct: the rows would otherwise
    # violate the constraint being restored.
    op.drop_constraint("ck_payment_request_source", "payment_request", type_="check")
    op.create_check_constraint(
        "ck_payment_request_source",
        "payment_request",
        "source IN ('API', 'MCP_AGENT', 'ATTACK_HARNESS')",
    )
    op.drop_table("paytm_order")
    op.drop_index("ix_basket_line_basket", table_name="basket_line")
    op.drop_table("basket_line")
    op.drop_table("basket")
