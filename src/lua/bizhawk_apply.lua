-- BizHawk 2.11.1 BSNES: poke RHSTATE1 domains + CPU, then savestate.save.
-- Generated preamble sets WRAM_PATH, VRAM_PATH, CGRAM_PATH, OAM_PATH,
-- APURAM_PATH, OUT_PATH, and CPU { a,x,y,d,db,p,sp,pc,e }.

local function domain_list()
  local ok, list = pcall(memory.getmemorydomainlist)
  if not ok or type(list) ~= "table" then return {} end
  return list
end

local function has_domain(name)
  for _, d in ipairs(domain_list()) do
    if d == name then return true end
  end
  return false
end

local function first_domain(candidates)
  for _, name in ipairs(candidates) do
    if has_domain(name) then return name end
  end
  return nil
end

local function write_bin(candidates, path)
  if not path then return end
  local f = io.open(path, "rb")
  if not f then
    print("rhstate1-bizhawk: missing bin " .. tostring(path))
    return
  end
  local domain = first_domain(candidates)
  if not domain then
    print("rhstate1-bizhawk: skip missing domain " .. candidates[1])
    f:close()
    return
  end
  memory.usememorydomain(domain)
  local addr = 0
  while true do
    local chunk = f:read(4096)
    if not chunk then break end
    for i = 1, #chunk do
      memory.writebyte(addr, chunk:byte(i))
      addr = addr + 1
    end
  end
  f:close()
  print("rhstate1-bizhawk: wrote " .. domain .. " (" .. addr .. " bytes)")
end

local function try_set(name, value)
  if value == nil then return end
  pcall(function()
    emu.setregister(name, value)
  end)
end

write_bin({ "WRAM" }, WRAM_PATH)
write_bin({ "VRAM" }, VRAM_PATH)
write_bin({ "CGRAM", "CGRAM/CGDATA", "PALRAM" }, CGRAM_PATH)
write_bin({ "OAM", "OAMRAM" }, OAM_PATH)
write_bin({ "APURAM", "ARAM", "APU RAM" }, APURAM_PATH)

if CPU then
  try_set("A", CPU.a)
  try_set("X", CPU.x)
  try_set("Y", CPU.y)
  try_set("D", CPU.d)
  try_set("DB", CPU.db)
  try_set("P", CPU.p)
  try_set("S", CPU.sp)
  try_set("PC", CPU.pc % 0x10000)
  try_set("PB", math.floor(CPU.pc / 0x10000) % 0x100)
  try_set("K", math.floor(CPU.pc / 0x10000) % 0x100)
  try_set("E", CPU.e)
end

if not OUT_PATH then
  error("rhstate1-bizhawk: OUT_PATH is not set")
end
savestate.save(OUT_PATH)
print("rhstate1-bizhawk: saved " .. OUT_PATH)
client.exit()
