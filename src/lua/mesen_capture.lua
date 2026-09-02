-- Mesen-2 in-level capture. DUMP_DIR, MODE, TIMEOUT_FRAMES injected by rhcap1-mesen.
-- createSavestate is only legal inside a cpuExec memory callback. The .mss is a
-- throwaway vehicle: Node parses it into portable RHSTATE1 and deletes it.

local frame = 0
local captured = false
local busy = false
local need_fallback = false
local exec_ref = nil
local exec_cb = (emu.callbackType and emu.callbackType.exec) or 2
local done_path = DUMP_DIR .. "/done"
local wram_path = DUMP_DIR .. "/wram.bin"
local meta_path = DUMP_DIR .. "/meta.json"
local cpu_path = DUMP_DIR .. "/cpu.json"
local mss_path = DUMP_DIR .. "/mesen.mss"

local function memtypes()
  local mt = emu.memType or {}
  return {
    wram = mt.snesWorkRam or mt.workRam or mt.snesMemory or mt.cpuMemory,
    vram = mt.snesVideoRam or mt.videoRam,
    cgram = mt.snesCgRam or mt.cgRam,
    oam = mt.snesSpriteRam or mt.spriteRam,
    sram = mt.snesSaveRam or mt.saveRam,
    spc = mt.spcRam or mt.snesSpcRam,
    dsp = mt.spcDspRegisters or mt.snesSpcDsp or mt.spcDsp,
    sa1_iram = mt.sa1InternalRam,
    gsu = mt.gsuWorkRam,
    cx4 = mt.cx4DataRam,
    dsp_data = mt.dspDataRam,
    st018 = mt.st018WorkRam,
    debug = mt.snesDebug or mt.snesMemory,
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

local function mem_size(mtype)
  if not mtype or not emu.getMemorySize then return nil end
  local ok, n = pcall(function() return emu.getMemorySize(mtype) end)
  if ok and type(n) == "number" and n > 0 then return math.floor(n) end
  return nil
end

-- getState returns Lua booleans for Mesen bool fields; never pass those to math.floor.
local function as_num(n)
  if n == true then return 1 end
  if n == false or n == nil then return 0 end
  if type(n) == "number" then return n end
  return tonumber(n) or 0
end

local function first_defined(...)
  local n = select("#", ...)
  for i = 1, n do
    local v = select(i, ...)
    if v ~= nil then return v end
  end
  return nil
end

local function json_num(n)
  return tostring(math.floor(as_num(n)))
end

local function dump_region(path, mtype, size)
  if not mtype or not size or size <= 0 then return false end
  local f = io.open(path, "wb")
  if not f then return false end
  local i = 0
  local use32 = emu.read32 ~= nil
  while i < size do
    if use32 and (i + 4) <= size then
      local ok, v = pcall(function() return emu.read32(i, mtype) end)
      if not ok or type(v) ~= "number" then
        use32 = false
      else
        v = v % 4294967296
        local b0 = v % 256
        local b1 = math.floor(v / 256) % 256
        local b2 = math.floor(v / 65536) % 256
        local b3 = math.floor(v / 16777216) % 256
        f:write(string.char(b0, b1, b2, b3))
        i = i + 4
      end
    else
      local b = read_byte(i, mtype)
      if b == nil then
        f:close()
        return false
      end
      f:write(string.char(as_num(b) % 256))
      i = i + 1
    end
  end
  f:close()
  return true
end

local function probe_sram(mtype)
  local n = mem_size(mtype)
  if n then return n end
  if not mtype then return 0 end
  local size = 0
  while size < 128 * 1024 do
    local b = read_byte(size, mtype)
    if b == nil then break end
    size = size + 4096
  end
  return size
end

local function write_json_cpu(st)
  local f = io.open(cpu_path, "w")
  if not f then return end
  local a = as_num(first_defined(st["cpu.a"], st.a, 0))
  local x = as_num(first_defined(st["cpu.x"], st.x, 0))
  local y = as_num(first_defined(st["cpu.y"], st.y, 0))
  local d = as_num(first_defined(st["cpu.d"], st.d, 0))
  local db = as_num(first_defined(st["cpu.dbr"], st["cpu.db"], st.db, 0))
  local p = as_num(first_defined(st["cpu.ps"], st["cpu.p"], st.p, 0))
  local sp = as_num(first_defined(st["cpu.sp"], st.sp, 0))
  local pc16 = as_num(first_defined(st["cpu.pc"], st.pc, 0))
  local k = as_num(st["cpu.k"])
  local e = as_num(first_defined(st["cpu.emulationMode"], st["cpu.e"], st.e, 1))
  local waiting = (as_num(st["cpu.stopState"]) == 2) and 1 or 0
  local nmi = as_num(st["cpu.needNmi"])
  local irq = (as_num(st["cpu.irqSource"]) ~= 0) and 1 or 0
  local pc = ((k % 256) * 65536) + (pc16 % 65536)
  f:write("{\"a\":" .. json_num(a) .. ",\"x\":" .. json_num(x) .. ",\"y\":" .. json_num(y) ..
    ",\"d\":" .. json_num(d) .. ",\"db\":" .. json_num(db) .. ",\"p\":" .. json_num(p) ..
    ",\"sp\":" .. json_num(sp) .. ",\"pc\":" .. json_num(pc) .. ",\"e\":" .. json_num(e) ..
    ",\"waiting\":" .. json_num(waiting) .. ",\"nmi_pending\":" .. json_num(nmi) ..
    ",\"irq_pending\":" .. json_num(irq) .. "}")
  f:close()
end

local CHIP_KEYS = {
  "cpu.a", "cpu.x", "cpu.y", "cpu.d", "cpu.dbr", "cpu.ps", "cpu.sp", "cpu.pc", "cpu.k",
  "cpu.emulationMode", "cpu.stopState", "cpu.needNmi", "cpu.irqSource",
  "spc.a", "spc.x", "spc.y", "spc.ps", "spc.sp", "spc.pc", "spc.dspReg", "spc.romEnabled",
  "ppu.forcedBlank", "ppu.screenBrightness", "ppu.bgMode", "ppu.mainScreenLayers",
  "ppu.subScreenLayers", "ppu.vramAddress", "ppu.cgramAddress", "internalRegisters.enableNmi",
  "internalRegisters.enableFastRom", "dmaController.hdmaChannels",
}

local function write_chips(st)
  local f = io.open(DUMP_DIR .. "/chips.json", "w")
  if not f then return end
  f:write("{")
  local first = true
  for _, k in ipairs(CHIP_KEYS) do
    local v = st[k]
    if v ~= nil then
      if not first then f:write(",") end
      first = false
      f:write(string.format("%q:%s", k, json_num(v)))
    end
  end
  f:write("}")
  f:close()
end

local function dump_bins(mt)
  if not dump_region(wram_path, mt.wram, 128 * 1024) then
    local f = io.open(wram_path, "wb")
    if f and mt.wram == nil and emu.memType and emu.memType.snesMemory then
      for i = 0, 128 * 1024 - 1 do
        local b = read_byte(0x7E0000 + i, emu.memType.snesMemory) or 0
        f:write(string.char(as_num(b) % 256))
      end
    end
    if f then f:close() end
  end
  dump_region(DUMP_DIR .. "/vram.bin", mt.vram, 64 * 1024)
  dump_region(DUMP_DIR .. "/cgram.bin", mt.cgram, 512)
  dump_region(DUMP_DIR .. "/oam.bin", mt.oam, 544)
  dump_region(DUMP_DIR .. "/spc_aram.bin", mt.spc, 64 * 1024)
  dump_region(DUMP_DIR .. "/dsp.bin", mt.dsp, 128)
  dump_region(DUMP_DIR .. "/fillram.bin", mt.debug, 0x8000)
  local sram_n = probe_sram(mt.sram)
  if sram_n > 0 then dump_region(DUMP_DIR .. "/sram.bin", mt.sram, sram_n) end
  local sa1n = mem_size(mt.sa1_iram)
  if sa1n then dump_region(DUMP_DIR .. "/sa1_iram.bin", mt.sa1_iram, sa1n) end
  local gsun = mem_size(mt.gsu)
  if gsun then dump_region(DUMP_DIR .. "/gsu_wram.bin", mt.gsu, gsun) end
  local cx4n = mem_size(mt.cx4)
  if cx4n then dump_region(DUMP_DIR .. "/cx4_data.bin", mt.cx4, cx4n) end
  local dspn = mem_size(mt.dsp_data)
  if dspn then dump_region(DUMP_DIR .. "/dsp_data.bin", mt.dsp_data, dspn) end
  local stn = mem_size(mt.st018)
  if stn then dump_region(DUMP_DIR .. "/st018_wram.bin", mt.st018, stn) end
end

local function try_savestate()
  if not emu.createSavestate then return false end
  local ok, blob = pcall(emu.createSavestate)
  if not ok or type(blob) ~= "string" or #blob < 35 then return false end
  local f = io.open(mss_path, "wb")
  if not f then return false end
  f:write(blob)
  f:close()
  return true
end

local function write_meta(st, mt)
  local gm = as_num(read_byte(0x0100, mt.wram))
  if gm == 0 then gm = 0x14 end
  local pc = as_num(st["cpu.pc"])
  local k = as_num(st["cpu.k"])
  local pc24 = ((k % 256) * 65536) + (pc % 65536)
  local scan = as_num(st["ppu.scanline"])
  local f = io.open(meta_path, "w")
  if f then
    f:write("{\"profile\":\"in_level\",\"game_mode\":" .. json_num(gm) ..
      ",\"pc\":" .. json_num(pc24) .. ",\"frame\":" .. json_num(frame) ..
      ",\"scanline\":" .. json_num(scan) .. "}")
    f:close()
  end
end

local function write_done()
  local d = io.open(done_path, "w")
  if d then
    d:write("ok\n")
    d:close()
  end
end

local function stop_emu()
  -- Debugger step (breakExecution) pauses the UI. Use stop so rhcap1-mesen can exit.
  if emu.stop then pcall(emu.stop) end
end

local function unhook_exec()
  if not exec_ref or not emu.removeMemoryCallback then return end
  pcall(function()
    emu.removeMemoryCallback(exec_ref, exec_cb, 0, 0xFFFFFF)
  end)
  exec_ref = nil
end

local function get_state()
  if not emu.getState then return {} end
  local ok, s = pcall(emu.getState)
  if ok and type(s) == "table" then return s end
  return {}
end

local function finish_from_exec()
  local mt = memtypes()
  local used = try_savestate()
  local st = get_state()
  write_json_cpu(st)
  write_chips(st)
  write_meta(st, mt)
  if used then
    write_done()
    captured = true
    stop_emu()
    return
  end
  -- Byte dumps are too slow inside cpuExec; do them on the next startFrame.
  need_fallback = true
end

local function on_exec()
  if captured or busy then return end
  busy = true
  unhook_exec()
  local ok, err = pcall(finish_from_exec)
  if not ok then
    local f = io.open(DUMP_DIR .. "/failed", "w")
    if f then
      f:write(tostring(err) .. "\n")
      f:close()
    end
    captured = true
    stop_emu()
  end
end

local function arm_exec()
  if busy or captured or exec_ref then return end
  if emu.addMemoryCallback then
    local ok, ref = pcall(function()
      return emu.addMemoryCallback(on_exec, exec_cb, 0, 0xFFFFFF)
    end)
    if ok then exec_ref = ref end
  end
  if not exec_ref then
    -- no cpuExec: dump on this frame (cannot createSavestate)
    busy = true
    need_fallback = true
  end
end

local function in_level(mt)
  local gm = read_byte(0x0100, mt.wram)
  if gm ~= 0x14 then return false end
  local anim = read_byte(0x0071, mt.wram)
  if anim == nil then return true end
  return anim == 0
end

local function on_frame()
  if captured then return end
  frame = frame + 1
  if frame > TIMEOUT_FRAMES then
    local d = io.open(DUMP_DIR .. "/failed", "w")
    if d then
      d:write("timeout\n")
      d:close()
    end
    stop_emu()
    return
  end

  if MODE == "auto" then
    local down = (frame >= 60 and frame < 70) or (frame >= 120 and frame < 130) or (frame >= 300 and frame < 310)
    if rh_set_start then rh_set_start(down) end
  end

  if need_fallback then
    local mt = memtypes()
    pcall(function() dump_bins(mt) end)
    if not captured then
      write_done()
      captured = true
      stop_emu()
    end
    return
  end

  local mt = memtypes()
  if in_level(mt) then
    arm_exec()
  end
end

if emu.addEventCallback and emu.eventType then
  emu.addEventCallback(on_frame, emu.eventType.startFrame or emu.eventType.endFrame or 0)
elseif emu.addEventCallback then
  emu.addEventCallback(on_frame, 0)
end
