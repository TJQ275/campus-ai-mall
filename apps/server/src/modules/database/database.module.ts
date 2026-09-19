import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createDb, ensureVectorExtension, type Db, type DbHandle } from '../../db/client.js';

export const DB = Symbol('DB');
export const DB_HANDLE = Symbol('DB_HANDLE');

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      useFactory: async (): Promise<DbHandle> => {
        const handle = await createDb();
        await ensureVectorExtension(handle);
        return handle;
      },
    },
    { provide: DB, useFactory: (handle: DbHandle): Db => handle.db, inject: [DB_HANDLE] },
  ],
  exports: [DB, DB_HANDLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown() {
    const handle = this.moduleRef.get<DbHandle>(DB_HANDLE, { strict: false });
    await handle?.close();
  }
}
