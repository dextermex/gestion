/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { withOrg, dbError, isUuid, refuseWithout } from "@/lib/gestion/api";
import { refuseForeignLoanTargets } from "@/lib/gestion/investment-targets";
import { getDatasetId } from "@/lib/demo";
import { ACQUISITION_COLUMNS, mapLoanRow, mapAcquisitionRow, investmentWrite } from "@/lib/gestion/investment";
import { loanSchema } from "@/lib/investment/loans";
import { acquisitionSchema } from "@/lib/investment/acquisition";
import { LOAN_COLUMNS as LC } from "@/lib/gestion/investment";
type Kind="loans"|"acquisitions";
const table=(k:Kind)=>k==="loans"?"investment_loans":"acquisition_projects";
export async function PATCH(req:Request,{params}:{params:Promise<{kind:string,id:string}>}){const p=await params;const kind=p.kind as Kind;if((kind!=="loans"&&kind!=="acquisitions")||!isUuid(p.id))return NextResponse.json({error:"not_found"},{status:404});if(await getDatasetId()!=="real")return NextResponse.json({error:"sample_read_only"},{status:403});const c=await withOrg("write");if(c instanceof NextResponse)return c;
  const refused=await refuseWithout(c,"gestion.finance.edit");if(refused)return refused;
  const body=await req.json().catch(()=>null);const parsed=(kind==="loans"?loanSchema:acquisitionSchema).safeParse(body?.draft);if(!parsed.success||typeof body?.expectedUpdatedAt!=="string")return NextResponse.json({error:"invalid_record"},{status:400});
  // The property and the lot a loan names are the workspace's own.
  if(kind==="loans"){const foreign=await refuseForeignLoanTargets(c,parsed.data as {propertyId?:string|null;unitId?:string|null});if(foreign)return foreign;}
  const cols=kind==="loans"?LC:ACQUISITION_COLUMNS;const q:any=c.g.from(table(kind));const {data,error}=await q.update(investmentWrite(parsed.data,kind)).eq("id",p.id).eq("org_id",c.org.id).eq("updated_at",body.expectedUpdatedAt).select(cols).maybeSingle();if(error)return dbError("investment update",error);if(!data)return NextResponse.json({error:"conflict_or_not_found"},{status:409});return NextResponse.json({record:kind==="loans"?mapLoanRow(data):mapAcquisitionRow(data)});}
