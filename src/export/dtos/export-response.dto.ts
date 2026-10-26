export class ExportProductDto {
  uuid: string;
  slug: string;
  titleEn: string;
  titleAr: string;
  status: string;
  procurementId: string | null;
  shopId: string | null;
  shopName: string | null;
  variantsCount: number;
  totalStock: number;
  minPrice: number | null;
  maxPrice: number | null;
  avgPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

export class ExportResponseDto {
  success: boolean;
  message: string;
  productsCount?: number;
  filePath?: string;
  error?: string;
}