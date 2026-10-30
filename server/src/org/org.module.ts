import { Global, Module } from '@nestjs/common';
import { OrgService } from './org.service';
import { StructureTransferService } from './structure-transfer.service';
import { EmployeeTransferService } from './employee-transfer.service';
import { TransferController } from './transfer.controller';

/** Структура компании нужна согласованию, выгрузкам и обмену — модуль глобальный, как аудит. */
@Global()
@Module({
  controllers: [TransferController],
  providers: [OrgService, StructureTransferService, EmployeeTransferService],
  exports: [OrgService],
})
export class OrgModule {}
