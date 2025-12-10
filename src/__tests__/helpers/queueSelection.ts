export function setSelectedJobIds(vm: any, ids: string[]) {
  const next = new Set(ids);
  const value = vm.selectedJobIds;

  if (value instanceof Set) {
    vm.selectedJobIds = next;
  } else if (value && "value" in value) {
    value.value = next;
  }
}
