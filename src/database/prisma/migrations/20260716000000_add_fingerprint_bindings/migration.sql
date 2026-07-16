CREATE TABLE "fingerprint" (
    "id" SERIAL NOT NULL,
    "slot" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fingerprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fingerprint_slot_key" ON "fingerprint"("slot");

ALTER TABLE "fingerprint"
ADD CONSTRAINT "fingerprint_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "user"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
