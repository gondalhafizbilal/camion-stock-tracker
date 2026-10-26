import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

import { TrackerModule } from '../tracker/tracker.module';
import { CamionApiProvider } from '../tracker/providers/camion-api.provider';

@Module({
  imports: [TrackerModule],
  providers: [
    ExportService,
    CamionApiProvider,
  ],
  controllers: [ExportController]
})
export class ExportModule { }
