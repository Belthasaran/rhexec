-- Headless boot-restore probe. RESULT_DIR / TIMEOUT_FRAMES injected by writeBootProbeScript.
-- Passes if WRAM $7E0010 becomes non-zero (SMW NMI ran). Stops the emu either way.

local frame = 0
local finished = false
local last_10 = 0
local last_pc = 0
local last_spc = 0
local last_0100 = 0
local last_4200 = 0
local last_2140 = 0
local last_2141 = 0
local result_path = RESULT_DIR .. "/nmi_probe.json"
local done_path = RESULT_DIR .. "/done"
local failed_path = RESULT_DIR .. "/failed"

local function memtypes()
  local mt = emu.memType or {}
  return {
    wram = mt.snesWorkRam or mt.workRam or mt.snesMemory or mt.cpuMemory,
    cpu = mt.snesCpuMemory or mt.cpuMemory or mt.snesMemory or mt.snesDebug,
  }
end

local function read_byte(addr, mtype)
  if not mtype then return nil end
  local ok, v = pcall(function()
    return emu.read(addr, mtype)
  end)
  if ok then return v end
  return nil
end

local function as_num(n)
  if n == true then return 1 end
  if n == false or n == nil then return 0 end
  if type(n) == "number" then return n end
  return tonumber(n) or 0
end

local function snapshot_state()
  if not emu.getState then return end
  local ok, st = pcall(emu.getState)
  if not ok or type(st) ~= "table" then return end
  local pc16 = as_num(st["cpu.pc"] or st.pc)
  local k = as_num(st["cpu.k"])
  last_pc = ((k % 256) * 65536) + (pc16 % 65536)
  last_spc = as_num(st["spc.pc"] or st.spcPc or 0)
end

local function stop_emu()
  if emu.stop then pcall(emu.stop) end
end

local function write_json(ok)
  local f = io.open(result_path, "w")
  if f then
    local okj = ok and "true" or "false"
    f:write("{\"ok\":" .. okj ..
      ",\"frame\":" .. tostring(frame) ..
      ",\"last_10\":" .. tostring(as_num(last_10)) ..
      ",\"last_0100\":" .. tostring(as_num(last_0100)) ..
      ",\"last_4200\":" .. tostring(as_num(last_4200)) ..
      ",\"last_2140\":" .. tostring(as_num(last_2140)) ..
      ",\"last_2141\":" .. tostring(as_num(last_2141)) ..
      ",\"spc_pc\":" .. tostring(as_num(last_spc)) ..
      ",\"pc\":" .. tostring(as_num(last_pc)) .. "}")
    f:close()
  end
  local d = io.open(done_path, "w")
  if d then
    d:write(ok and "ok\n" or "fail\n")
    d:close()
  end
end

local function finish(ok)
  if finished then return end
  finished = true
  snapshot_state()
  write_json(ok)
  stop_emu()
end

local function on_frame()
  if finished then return end
  frame = frame + 1
  local mt = memtypes()
  local v = read_byte(0x0010, mt.wram)
  if v ~= nil then last_10 = as_num(v) end
  local gm = read_byte(0x0100, mt.wram)
  if gm ~= nil then last_0100 = as_num(gm) end
  local nmi = read_byte(0x4200, mt.cpu)
  if nmi ~= nil then last_4200 = as_num(nmi) end
  snapshot_state()
  local a0 = read_byte(0x2140, mt.cpu)
  if a0 ~= nil then last_2140 = as_num(a0) end
  local a1 = read_byte(0x2141, mt.cpu)
  if a1 ~= nil then last_2141 = as_num(a1) end
  if last_10 ~= 0 then
    finish(true)
    return
  end
  if frame >= TIMEOUT_FRAMES then
    finish(false)
  end
end

if emu.addEventCallback and emu.eventType then
  emu.addEventCallback(on_frame, emu.eventType.startFrame or emu.eventType.endFrame or 0)
elseif emu.addEventCallback then
  emu.addEventCallback(on_frame, 0)
else
  local f = io.open(failed_path, "w")
  if f then
    f:write("no addEventCallback\n")
    f:close()
  end
  write_json(false)
  stop_emu()
end
