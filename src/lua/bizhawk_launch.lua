-- Concatenated after bizhawk_poke.lua. Preamble may set CONNECTOR_PATH.

pcall(function()
  client.unpause()
end)

if CONNECTOR_PATH then
  print("rhlaunch1-bizhawk: loading Connector " .. CONNECTOR_PATH)
  dofile(CONNECTOR_PATH)
end
