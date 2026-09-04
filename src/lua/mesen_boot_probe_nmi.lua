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

local function cpu_pc24()
  if not emu.getState then return 0 end
  local ok, st = pcall(emu.getState)
  if not ok or type(st) ~= "table" then return 0 end
  local pc16 = as_num(st["cpu.pc"] or st.pc)
  local k = as_num(st["cpu.k"])
  return ((k % 256) * 65536) + (pc16 % 65536)
end

local function spc_pc16()
  if not emu.getState then return 0 end
  local ok, st = pcall(emu.getState)
  if not ok or type(st) ~= "table" then return 0 end
  return as_num(st["spc.pc"] or st.spcPc or 0)
end

local function debug_log(hid, msg)
  if not DEBUG_LOG_PATH or DEBUG_LOG_PATH == "" then return end
  local f = io.open(DEBUG_LOG_PATH, "a")
  if not f then return end
  f:write(string.format(
    '{"sessionId":"c4b0c8","hypothesisId":"%s","location":"mesen_boot_probe_nmi.lua","message":"%s","data":{"frame":%d,"cpuPc":%d,"spcPc":%d,"wram10":%d,"wram0100":%d,"nmitimen":%d,"apuio0":%d,"apuio1":%d},"timestamp":%d,"runId":"post-fix-026"}\n',
    hid, msg, frame, as_num(last_pc), as_num(last_spc), as_num(last_10), as_num(last_0100), as_num(last_4200), as_num(last_2140), as_num(last_2141), (os.time() * 1000)
  ))
  f:close()
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
  last_pc = cpu_pc24()
  last_spc = spc_pc16()
  write_json(ok)
  debug_log(ok and "C" or "A", ok and "nmi-ok" or "nmi-timeout")
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
  last_pc = cpu_pc24()
  last_spc = spc_pc16()
  local a0 = read_byte(0x2140, mt.cpu)
  if a0 ~= nil then last_2140 = as_num(a0) end
  local a1 = read_byte(0x2141, mt.cpu)
  if a1 ~= nil then last_2141 = as_num(a1) end
  if frame == 1 or frame == 60 then
    debug_log("B", "frame-snapshot")
  end
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
