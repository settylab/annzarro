"""Classes for managing run information and comparisons."""
import pandas as pd
import numpy as np
from typing import Optional, Dict, Any, List, Union, Tuple, Callable
from anndata import AnnData
import logging
import copy
import pprint

from .json_utils import from_json_string, get_json_metadata, set_json_metadata
from .field_tracking import get_run_from_history, validate_field_run_id

logger = logging.getLogger("kompot")


class RunInfo:
    """
    Class for accessing run information for differential analysis.
    
    Provides access to run history, parameters, and result fields.
    
    Attributes
    ----------
    adata : AnnData
        AnnData object containing the run history
    run_id : int
        Requested run ID (may be negative for relative indexing)
    adjusted_run_id : int
        Actual run ID after adjusting for negative indexing
    analysis_type : str
        Type of analysis: 'de' for differential expression or 'da' for differential abundance
    storage_key : str
        Key for accessing the analysis data in adata.uns
    run_info : dict
        Dictionary with all information about the run
    field_names : dict
        Dictionary with field names used in this run
    params : dict
        The parameters used for this analysis
    environment : dict
        Information about the environment where the analysis was run
    overwritten_fields : list
        List of fields that were overwritten by newer runs
    """
    
    def __init__(self, 
                 adata, 
                 run_id: Optional[int] = None, 
                 analysis_type: Optional[str] = None):
        """
        Initialize a RunInfo object.
        
        Parameters
        ----------
        adata : AnnData
            AnnData object containing run history
        run_id : int, optional
            Run ID to retrieve. Negative indices count from the end.
            If None, uses the most recent run (-1).
        analysis_type : str, optional
            Type of analysis: 'de' for differential expression or 
            'da' for differential abundance. If None, attempts to detect.
        """
        self.adata = adata
        if run_id is None:
            run_id = -1  # Default to most recent run
        self.run_id = run_id
        
        # Detect analysis type if not provided
        if analysis_type is None:
            # Try to detect from uns keys
            if 'kompot_de' in adata.uns and 'run_history' in adata.uns['kompot_de']:
                analysis_type = 'de'
            elif 'kompot_da' in adata.uns and 'run_history' in adata.uns['kompot_da']:
                analysis_type = 'da'
            else:
                raise ValueError("Could not detect analysis type. Please specify 'de' or 'da'.")
                
        if analysis_type not in ['de', 'da']:
            raise ValueError(f"Invalid analysis_type: {analysis_type}. Must be 'de' or 'da'.")
            
        self.analysis_type = analysis_type
        self.storage_key = f"kompot_{analysis_type}"
        
        # Check if run history exists
        if (self.storage_key not in adata.uns or 
            'run_history' not in adata.uns[self.storage_key] or
            len(adata.uns[self.storage_key]['run_history']) == 0):
            raise ValueError(f"No run history found for {analysis_type} analysis.")
        
        # Get run info
        self.run_info = get_run_from_history(adata, run_id=run_id, analysis_type=analysis_type)
        
        if self.run_info is None:
            raise ValueError(f"Run ID {run_id} not found in {analysis_type} run history.")
            
        # Set adjusted run_id
        self.adjusted_run_id = self.run_info.get('adjusted_run_id', None)
        
        # Extract key information
        self.field_names = self.run_info.get('field_names', {})
        self.params = self.run_info.get('params', {}).copy()  # Make a copy to avoid modifying the original
        self.environment = self.run_info.get('environment', {})
        self.timestamp = self.run_info.get('timestamp', '')
        
        # Ensure result_key is included in params if missing
        if 'result_key' not in self.params and 'result_key' in self.run_info:
            self.params['result_key'] = self.run_info['result_key']
        
        # Get all fields modified by this run
        self.adata_fields = self._get_fields_for_run()
        
        # Check for fields that have been overwritten by newer runs
        self.overwritten_fields = self._check_overwritten_fields()
        
    def _get_fields_for_run(self) -> Dict[str, List[str]]:
        """
        Get all fields in the AnnData object that were written by this run.
        
        Returns
        -------
        Dict[str, List[str]]
            Dictionary with AnnData locations as keys and lists of field names as values
        """
        result = {}
        
        # Get fields from field_mapping in the run_info - this is the only source of truth
        run_data = self.get_raw_data()
        field_mapping = run_data.get('field_mapping', {})
        
        # If field_mapping is a string, try to parse it as JSON
        if isinstance(field_mapping, str):
            try:
                field_mapping = from_json_string(field_mapping)
            except Exception as e:
                logger.warning(f"Error parsing field_mapping as JSON: {e}")
                field_mapping = {}
        
        if not field_mapping:
            logger.warning(f"No field_mapping found for run {self.adjusted_run_id}.")
            return {}
            
        # Initialize result - ensure mapping is a dict before accessing
        locations = set()
        for mapping_value in field_mapping.values():
            if isinstance(mapping_value, dict) and 'location' in mapping_value:
                locations.add(mapping_value['location'])
            elif isinstance(mapping_value, str):
                # Try to parse as JSON
                try:
                    mapping_dict = from_json_string(mapping_value)
                    if isinstance(mapping_dict, dict) and 'location' in mapping_dict:
                        locations.add(mapping_dict['location'])
                except Exception:
                    pass
                    
        for location in locations:
            result[location] = []
            
        # Add fields to their locations
        for field, mapping in field_mapping.items():
            # Handle case where mapping is a string (serialized JSON)
            if isinstance(mapping, str):
                try:
                    mapping = from_json_string(mapping)
                except Exception:
                    continue
                    
            # Only process dictionary mappings with location
            if isinstance(mapping, dict) and 'location' in mapping:
                location = mapping['location']
                if location not in result:
                    result[location] = []
                result[location].append(field)
        
        # Sort field lists for consistent display
        for location in result:
            result[location].sort()
            
        return result
    
    def _check_overwritten_fields(self) -> List[Dict[str, Any]]:
        """
        Check if any fields from this run have been overwritten by newer runs.
        
        Returns
        -------
        List[Dict[str, Any]]
            List of dictionaries with overwritten field information, each containing:
            - field: The field name
            - location: The location in AnnData (obs, var, etc.)
            - current_run_id: The run ID that now owns this field
            - expected_run_id: The run ID that should own this field (this run)
        """
        if (self.storage_key not in self.adata.uns or 
            'anndata_fields' not in self.adata.uns[self.storage_key]):
            return []
            
        tracking = self.adata.uns[self.storage_key]['anndata_fields']
        
        # If tracking is a JSON string, deserialize it
        if isinstance(tracking, str):
            tracking = from_json_string(tracking)
            
        overwritten = []
        
        # Get fields from field_mapping as the source of truth
        field_mapping = self.get_raw_data().get('field_mapping', {})
        
        # If field_mapping is a string, try to parse it as JSON
        if isinstance(field_mapping, str):
            try:
                field_mapping = from_json_string(field_mapping)
            except Exception as e:
                logger.warning(f"Error parsing field_mapping as JSON: {e}")
                field_mapping = {}
        
        # If no field_mapping, we don't know what fields to check
        if not field_mapping:
            logger.warning(f"No field_mapping found for run {self.adjusted_run_id} to check for overwritten fields.")
            return []
        
        # Check each field from field_mapping against the tracking info
        for field, mapping in field_mapping.items():
            # Handle case where mapping might be a JSON string
            if isinstance(mapping, str):
                try:
                    mapping = from_json_string(mapping)
                except Exception:
                    continue
                    
            # Only process dictionary mappings
            if not isinstance(mapping, dict):
                continue
                
            location = mapping.get('location')
            if not location or location not in tracking or field not in tracking[location]:
                # Skip fields not in the tracking dictionary
                continue
                
            # Check if the field is attributed to a different run
            current_run_id = tracking[location][field]
            if current_run_id != self.adjusted_run_id:
                overwritten.append({
                    'field': field,
                    'location': location,
                    'current_run_id': current_run_id,
                    'expected_run_id': self.adjusted_run_id
                })
                    
        return overwritten
    
    def compare_with(self, other_run_id: int) -> 'RunComparison':
        """
        Compare this run with another run.
        
        Parameters
        ----------
        other_run_id : int
            Run ID to compare with
            
        Returns
        -------
        RunComparison
            Object containing comparison results with nice display methods
        """
        return RunComparison(self.adata, self.run_id, other_run_id, self.analysis_type)
    
    def get_data(self) -> Dict[str, Any]:
        """
        Get all data related to this run.
        
        Returns
        -------
        Dict[str, Any]
            Dictionary with all run data
        """
        # Get field data based on adata_fields
        field_data = {}
        
        # Initialize adata_fields as empty dict if not present
        if not hasattr(self, 'adata_fields') or not self.adata_fields:
            self.adata_fields = {}
            
        for location, fields in self.adata_fields.items():
            field_data[location] = {}
            
            if location == 'obs':
                for field in fields:
                    if field in self.adata.obs:
                        field_data[location][field] = self.adata.obs[field]
            elif location == 'var':
                for field in fields:
                    if field in self.adata.var:
                        field_data[location][field] = self.adata.var[field]
            elif location == 'uns':
                for field in fields:
                    if field in self.adata.uns:
                        field_data[location][field] = self.adata.uns[field]
            elif location == 'layers':
                for field in fields:
                    if field in self.adata.layers:
                        field_data[location][field] = self.adata.layers[field]
        
        return {
            'run_id': self.run_id,
            'adjusted_run_id': self.adjusted_run_id,
            'analysis_type': self.analysis_type,
            'field_names': self.field_names,
            'params': self.params,
            'environment': self.environment,
            'timestamp': self.timestamp,
            'overwritten_fields': self.overwritten_fields,
            'field_data': field_data
        }
    
    def get_summary(self) -> Dict[str, Any]:
        """
        Get a summary of this run with key information.
        
        Returns
        -------
        Dict[str, Any]
            Dictionary with run summary
        """
        # Get basic information without field data
        summary = {
            'run_id': self.run_id,
            'adjusted_run_id': self.adjusted_run_id,
            'analysis_type': self.analysis_type,
            'timestamp': self.timestamp,
            'conditions': f"{self.params.get('condition1', 'unknown')} to {self.params.get('condition2', 'unknown')}",
            'obsm_key': self.params.get('obsm_key', 'unknown'),
            'layer': self.params.get('layer', None),
            'uses_sample_variance': self.params.get('use_sample_variance', False),
            'field_count': sum(len(fields) for fields in self.adata_fields.values()) if self.adata_fields else 0,
            'overwritten_field_count': len(self.overwritten_fields) if hasattr(self, 'overwritten_fields') else 0,
            'overwritten_fields': self.overwritten_fields if hasattr(self, 'overwritten_fields') else []
        }
        
        # Add group information if available
        raw_data = self.get_raw_data()
        has_groups = raw_data.get('has_groups', False)
        if has_groups:
            groups_summary = raw_data.get('groups_summary', {})
            summary['has_groups'] = True
            summary['groups_count'] = groups_summary.get('count', 0)
            groups_names = groups_summary.get('names', [])
            # Provide a short preview of group names
            group_names_preview = ", ".join(groups_names[:3])
            if len(groups_names) > 3:
                group_names_preview += f" and {len(groups_names) - 3} more"
            summary['groups'] = group_names_preview
        else:
            summary['has_groups'] = False
        
        # Don't add anndata_locations directly to summary
        # We'll use it to enhance field listings instead
        return summary
    
    def get_raw_data(self) -> Dict[str, Any]:
        """
        Get the raw run info data without any processing.
        
        Returns
        -------
        Dict[str, Any]
            The raw run info data
        """
        return self.run_info
    
    def __repr__(self) -> str:
        """
        String representation of the RunInfo object.
        
        Returns
        -------
        str
            String representation
        """
        summary = self.get_summary()
        return f"RunInfo(analysis_type={summary['analysis_type']}, run_id={summary['adjusted_run_id']}, timestamp={summary['timestamp']})"


class RunComparison:
    """
    Class for comparing two runs of differential analysis.
    
    Attributes
    ----------
    adata : AnnData
        AnnData object containing the run history
    run1 : RunInfo
        First run to compare
    run2 : RunInfo
        Second run to compare
    """
    
    def __init__(self, 
                adata: AnnData, 
                run_id1: int, 
                run_id2: int, 
                analysis_type: str):
        """
        Initialize a RunComparison object.
        
        Parameters
        ----------
        adata : AnnData
            AnnData object containing run history
        run_id1 : int
            First run ID to compare
        run_id2 : int
            Second run ID to compare
        analysis_type : str
            Type of analysis: 'de' for differential expression or 'da' for differential abundance
        """
        self.adata = adata
        self.analysis_type = analysis_type
        
        # Create RunInfo objects for both runs
        self.run1 = RunInfo(adata, run_id=run_id1, analysis_type=analysis_type)
        self.run2 = RunInfo(adata, run_id=run_id2, analysis_type=analysis_type)
        
        # Get summaries
        self.summary1 = self.run1.get_summary()
        self.summary2 = self.run2.get_summary()
        
        # Compare parameters
        self.param_comparison = self._compare_parameters()
        
        # Compare fields
        self.field_comparison = self._compare_fields()
    
    def _compare_parameters(self) -> Dict[str, Any]:
        """
        Compare parameters between runs.
        
        Returns
        -------
        Dict[str, Any]
            Dictionary with parameter comparison results
        """
        # Get parameters from both runs
        params1 = self.run1.params
        params2 = self.run2.params
        
        # Find common, unique, and different parameters
        common_keys = set(params1.keys()).intersection(set(params2.keys()))
        
        # Categorize parameters
        same_params = {}
        different_params = {}
        
        for key in common_keys:
            if params1[key] == params2[key]:
                same_params[key] = params1[key]
            else:
                different_params[key] = {'run1': params1[key], 'run2': params2[key]}
        
        # Find unique parameters
        only_in_run1 = {k: params1[k] for k in params1 if k not in params2}
        only_in_run2 = {k: params2[k] for k in params2 if k not in params1}
        
        return {
            'same': same_params,
            'different': different_params,
            'only_in_run1': only_in_run1,
            'only_in_run2': only_in_run2
        }
    
    def _compare_fields(self) -> Dict[str, Any]:
        """
        Compare fields between runs.
        
        Returns
        -------
        Dict[str, Any]
            Dictionary with field comparison results
        """
        # Get fields from both runs
        fields1 = self.run1.adata_fields
        fields2 = self.run2.adata_fields
        
        # Initialize comparison data structure
        comparison = {'by_location': {}}
        
        # Build sets of locations and fields
        all_locations = set(fields1.keys()).union(set(fields2.keys()))
        
        # Compare fields by location
        for location in all_locations:
            # Initialize location comparison
            comparison['by_location'][location] = {
                'same': [],
                'only_in_run1': [],
                'only_in_run2': []
            }
            
            # Get field sets for this location
            fields_set1 = set(fields1.get(location, []))
            fields_set2 = set(fields2.get(location, []))
            
            # Compute same and different fields
            comparison['by_location'][location]['same'] = sorted(list(fields_set1.intersection(fields_set2)))
            comparison['by_location'][location]['only_in_run1'] = sorted(list(fields_set1 - fields_set2))
            comparison['by_location'][location]['only_in_run2'] = sorted(list(fields_set2 - fields_set1))
        
        # Add totals
        total_same = sum(len(data['same']) for data in comparison['by_location'].values())
        total_only_in_run1 = sum(len(data['only_in_run1']) for data in comparison['by_location'].values())
        total_only_in_run2 = sum(len(data['only_in_run2']) for data in comparison['by_location'].values())
        
        comparison['totals'] = {
            'same': total_same,
            'only_in_run1': total_only_in_run1,
            'only_in_run2': total_only_in_run2
        }
        
        return comparison
    
    def get_summary(self) -> Dict[str, Any]:
        """
        Get a summary of the comparison.
        
        Returns
        -------
        Dict[str, Any]
            Dictionary with comparison summary
        """
        return {
            'run1': {
                'run_id': self.run1.adjusted_run_id,
                'timestamp': self.summary1['timestamp'],
                'result_key': self.run1.params.get('result_key', 'unknown')
            },
            'run2': {
                'run_id': self.run2.adjusted_run_id,
                'timestamp': self.summary2['timestamp'],
                'result_key': self.run2.params.get('result_key', 'unknown')
            },
            'parameters': {
                'same_count': len(self.param_comparison['same']),
                'different_count': len(self.param_comparison['different']),
                'only_in_run1_count': len(self.param_comparison['only_in_run1']),
                'only_in_run2_count': len(self.param_comparison['only_in_run2'])
            },
            'fields': self.field_comparison['totals']
        }
    
    def __repr__(self) -> str:
        """
        String representation of the RunComparison object.
        
        Returns
        -------
        str
            String representation
        """
        summary = self.get_summary()
        return (f"RunComparison(run1={summary['run1']['run_id']}, "
                f"run2={summary['run2']['run_id']}, "
                f"same_fields={summary['fields']['same']}, "
                f"different_params={summary['parameters']['different_count']})")
    