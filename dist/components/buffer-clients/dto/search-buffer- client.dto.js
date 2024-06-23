"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchBufferClientDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class SearchBufferClientDto {
}
exports.SearchBufferClientDto = SearchBufferClientDto;
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Telegram ID of the client',
        example: '123456789',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchBufferClientDto.prototype, "tgId", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Mobile number of the client',
        example: '+1234567890',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchBufferClientDto.prototype, "mobile", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'createdDate of the bufferClient',
        example: '2023-06-22',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchBufferClientDto.prototype, "createdDate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'availableDate of the bufferClient',
        example: '2023-06-22',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchBufferClientDto.prototype, "availableDate", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Session identifier',
        example: 'session123',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SearchBufferClientDto.prototype, "session", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: 'Channel Count',
        example: 23,
        type: Number
    }),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], SearchBufferClientDto.prototype, "channels", void 0);
//# sourceMappingURL=search-buffer-%20client.dto.js.map