import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PropertyApplicationsService } from './property-applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { SignApplicationDto } from './dto/sign-application.dto';
import { DecideApplicationDto } from './dto/decide-application.dto';

@ApiTags('Property Applications')
@Controller('property-applications')
export class PropertyApplicationsController {
  constructor(private readonly service: PropertyApplicationsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Start an application (returns the existing draft if there is one)',
  })
  @ApiResponse({ status: 201, description: 'Draft application' })
  @ApiResponse({
    status: 404,
    description: 'Listing not found / no longer available',
  })
  @ApiResponse({
    status: 409,
    description: 'Already applied',
  })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.service.create(userId, dto.listingId);
  }

  @Get()
  @ApiOperation({ summary: "List the current user's applications" })
  async listMine(@CurrentUser('id') userId: string) {
    return this.service.listMine(userId);
  }

  // Declared before ':id' so "received" is not captured as an id.
  @Get('received')
  @ApiOperation({
    summary: "Applications for the landlord's listings (LANDLORD badge)",
  })
  @ApiResponse({ status: 403, description: 'Landlord badge required' })
  async listReceived(@CurrentUser('id') userId: string) {
    return this.service.listReceived(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one application (applicant or landlord)' })
  @ApiResponse({ status: 404, description: 'Application not found' })
  async getOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.getOne(userId, id);
  }

  @Patch(':id/step/:step')
  @ApiOperation({
    summary:
      'Save one wizard step (1 details, 2 rental history, 3 financial, 4 terms, 5 signature)',
  })
  @ApiBody({ description: 'Body shape depends on the step', type: Object })
  @ApiResponse({
    status: 400,
    description: 'Validation error naming the field',
  })
  @ApiResponse({ status: 409, description: 'Application already submitted' })
  async saveStep(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('step', ParseIntPipe) step: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.saveStep(userId, id, step, body);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the application and notify the landlord' })
  async submit(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.submit(userId, id);
  }

  @Post(':id/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Tenant e-signature (allowed after submit; becomes signed once approved)',
  })
  async sign(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: SignApplicationDto,
  ) {
    return this.service.sign(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Withdraw an application that is still a draft' })
  async withdraw(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.withdraw(userId, id);
  }

  @Patch(':id/decision')
  @ApiOperation({ summary: 'Approve or reject (landlord with LANDLORD badge)' })
  async decide(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: DecideApplicationDto,
  ) {
    return this.service.decide(userId, id, dto);
  }

  @Get(':id/deposit')
  @ApiOperation({ summary: 'Deposit status for an application' })
  async getDeposit(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.getDeposit(userId, id);
  }

  @Post(':id/deposit/pay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Start deposit payment (no provider yet: returns a reference and a null paymentUrl)',
  })
  async payDeposit(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.payDeposit(userId, id);
  }
}
