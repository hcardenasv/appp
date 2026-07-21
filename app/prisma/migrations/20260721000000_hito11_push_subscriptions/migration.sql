-- CreateTable push_subscriptions (Hito 11 — Web Push / PWA)
CREATE TABLE "push_subscriptions" (
    "sub_id"      UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID NOT NULL,
    "endpoint"    TEXT NOT NULL,
    "auth"        TEXT NOT NULL,
    "p256dh"      TEXT NOT NULL,
    "user_agent"  VARCHAR(512),
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("sub_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_user_id_endpoint_key"
    ON "push_subscriptions"("user_id", "endpoint");

-- AddForeignKey
ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
