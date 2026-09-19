import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { Db } from '../../db/client.js';
import { addresses } from '../../db/schema/index.js';

export interface AddressInput {
  receiver: string;
  phone: string;
  campus?: string;
  detail: string;
  isDefault?: boolean;
}

@Injectable()
export class AddressService {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(userId: number) {
    return this.db.select().from(addresses).where(eq(addresses.userId, userId)).orderBy(desc(addresses.isDefault), asc(addresses.id));
  }

  async create(userId: number, input: AddressInput) {
    if (input.isDefault) await this.clearDefault(userId);
    const existing = await this.db.select().from(addresses).where(eq(addresses.userId, userId));
    const inserted = await this.db
      .insert(addresses)
      .values({ ...input, userId, isDefault: input.isDefault ?? existing.length === 0 })
      .returning();
    return inserted[0];
  }

  async update(userId: number, id: number, input: Partial<AddressInput>) {
    if (input.isDefault) await this.clearDefault(userId);
    const updated = await this.db
      .update(addresses)
      .set(input)
      .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
      .returning();
    if (!updated[0]) throw new NotFoundException('地址不存在');
    return updated[0];
  }

  async remove(userId: number, id: number) {
    await this.db.delete(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, userId)));
    return { removed: true };
  }

  private async clearDefault(userId: number) {
    await this.db.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }
}
