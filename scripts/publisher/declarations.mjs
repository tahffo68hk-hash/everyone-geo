export const declarations = [
  "内容无需标注",
  "含AI生成内容",
  "含虚构演绎内容",
  "内容含营销信息",
  "个人观点，仅供参考",
  "内容为转载",
];
export function pickDeclaration(payload = {}) {
  const value =
    payload.declaration === undefined ? declarations[0] : payload.declaration;
  if (!declarations.includes(value))
    throw Error("创作声明无效：请选择平台支持的声明");
  return value;
}
