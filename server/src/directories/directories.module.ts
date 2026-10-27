import { Module } from '@nestjs/common';
import { DirectoriesController } from './directories.controller';

@Module({
  controllers: [DirectoriesController],
})
export class DirectoriesModule {}
