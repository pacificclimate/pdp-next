SELECT
    df.filename,
    dfv.netcdf_variable_name,
    dfv.range_min,
    dfv.range_max,
    e.ensemble_name
FROM pcic_meta.data_file_variables AS dfv
JOIN pcic_meta.data_files AS df
    ON df.data_file_id = dfv.data_file_id
JOIN pcic_meta.ensemble_data_file_variables AS edfv
    ON edfv.data_file_variable_id = dfv.data_file_variable_id
JOIN pcic_meta.ensembles AS e
    ON e.ensemble_id = edfv.ensemble_id
WHERE dfv.range_min IS NOT NULL
  AND dfv.range_max IS NOT NULL
  AND e.ensemble_name IN (
      'bccaq_version_2',
      'bccaq2_canesm5',
      'bccaq2_cmip6',
      'bc_prism_monthly_and_climos',
      'gridded-obs-met-data',
      'hydro_test',
      'mbcn_canesm5',
      'mbcn_cmip6',
      'vicgl_cmip5'
  )
ORDER BY e.ensemble_name, df.filename, dfv.data_file_variable_id;
