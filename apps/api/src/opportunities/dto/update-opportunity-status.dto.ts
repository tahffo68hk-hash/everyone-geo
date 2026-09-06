import { IsIn, IsString } from "class-validator";

/** ContentOpportunity 人工状态流转：只允许这三种（M7C 只做 planning）。 */
export const OPPORTUNITY_STATUS_TRANSITIONS: Record<string, string[]> = {
  PROPOSED: ["APPROVED", "DISMISSED"],
  APPROVED: ["PROPOSED"],
  DISMISSED: ["PROPOSED"],
};

export const OPPORTUNITY_STATUS_VALUES = ["PROPOSED", "APPROVED", "DISMISSED"] as const;

export class UpdateOpportunityStatusDto {
  @IsString()
  @IsIn(OPPORTUNITY_STATUS_VALUES as unknown as string[])
  status: string;
}
