-- AlterTable
ALTER TABLE `Goal` ADD COLUMN `isRecurring` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `recurrenceRule` JSON NULL;
