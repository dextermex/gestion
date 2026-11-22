/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { withOrg, dbError, refuseWithout } from "@/lib/gestion/api";
import { refuseForeignLoanTargets } from "@/lib/gestion/investment-targets";
import { getDatasetId } from "@/lib/demo";
import { LOAN_COLUMNS, ACQUISITION_COLUMNS, mapLoanRow, mapAcquisitionRow, investmentWrite } from "@/lib/gestion/investment";
import { loanSchema } from "@/lib/investment/loans";
import { acquisitionSchema } from "@/lib/investment/acquisition";

type Kind="loans"|"acquisitions";
const table=(k:Kind)=>k==="loans"?"investment_loans":"acquisition_projects";
export async function GET(_req:Request,{params}:{params:Promise<{kind:string}>}){const {kind}=await params;if(kind!=="loans"&&kind!=="acquisitions")return NextResponse.json({error:"not_found"},{status:404});const c=await withOrg();if(c instanceof NextResponse)return c;const q:any=c.g.from(table(kind));const {data,error}=await q.select(kind==="loans"?LOAN_COLUMNS:ACQUISITION_COLUMNS).eq("org_id",c.org.id).order("updated_at",{ascending:false});if(error)return dbError("investment list",error);return NextResponse.json({records:(data??[]).map((r:any)=>kind==="loans"?mapLoanRow(r):mapAcquisitionRow(r))});}
export async function POST(req:Request,{params}:{params:Promise<{kind:string}>}){const {kind}=await params;if(kind!=="loans"&&kind!=="acquisitions")return NextResponse.json({error:"not_found"},{status:404});if(await getDatasetId()!=="real")return NextResponse.json({error:"sample_read_only"},{status:403});const c=await withOrg("write");if(c instanceof NextResponse)return c;
  // The role is asked before anything is read or written: a clear refusal, not a row the database silently filters.
  const refused=await refuseWithout(c,"gestion.finance.edit");if(refused)return refused;
  const body=await req.json().catch(()=>null);const parsed=(kind==="loans"?loanSchema:acquisitionSchema).safeParse(body);if(!parsed.success)return NextResponse.json({error:"invalid_record",issues:parsed.error.flatten()},{status:400});
  // The property and the lot a loan names are the workspace's own.
  if(kind==="loans"){const foreign=await refuseForeignLoanTargets(c,parsed.data as {propertyId?:string|null;unitId?:string|null});if(foreign)return foreign;}
  const q:any=c.g.from(table(kind));const {data,error}=await q.insert({...investmentWrite(parsed.data,kind),org_id:c.org.id}).select(kind==="loans"?LOAN_COLUMNS:ACQUISITION_COLUMNS).single();if(error)return dbError("investment create",error);return NextResponse.json({record:kind==="loans"?mapLoanRow(data):mapAcquisitionRow(data)},{status:201});}
