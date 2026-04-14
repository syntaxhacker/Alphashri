export type HolidayType = "trading" | "clearing";

export interface MarketHoliday {
  date: string;
  description: string;
  type: HolidayType;
}

export interface HolidayCheck {
  date: string;
  is_holiday: boolean;
  type: HolidayType | "weekend" | null;
  description: string | null;
}
