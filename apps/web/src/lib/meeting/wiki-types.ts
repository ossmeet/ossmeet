export interface WikiImage {
  source: string;
  width?: number;
  height?: number;
}

export interface WikiArticle {
  title: string;
  extract: string;
  thumbnail?: WikiImage;
  originalimage?: WikiImage;
  content_urls?: { desktop: { page: string } };
}
